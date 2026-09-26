import JSON5 from 'json5';
import omit from 'lodash/omit';
import { z } from 'zod';

import { countdownOverlaySchema, imageOverlaySchema, mixOutputAspects, progressBarOverlaySchema, soundOverlaySchema, textOverlaySchema } from '../types';
import type { MixBlock, MixBlockDef, MixOutputAspect, MixOverlay, MixProject, OverlayAnchor, OverlayFile } from '../types';
import type { OverlayFileKind } from '../projectFile';
import { adaptBlockDefToAspect, buildBlockFromOverlays } from './blockOperations';
import type { ProjectTimes } from './blockOperations';
import { BLOCK_MEMBER_ID_SEPARATOR, getBlockDefDuration, getNormalizedMembers } from './expandBlocks';
import { getBlockDefVariables } from './blockVariables';

// `.vmxblock` files (H2, T56; T58 reads and writes them): a block of overlays exported as a template. Written as
// indented strict JSON, read as JSON5 (comments and trailing commas allowed, for hand edits), validated with zod with
// readable errors (field path and reason). The JSON Schema for editors is generated from `vmxBlockFileSchema`
// (docs/videomix/vmxblock.schema.json, checked by a test). Pure: file access is the caller's.

export const VMXBLOCK_FORMAT = 'videomix-block';
export const VMXBLOCK_VERSION = 1;
export const vmxBlockExtension = 'vmxblock';

/** A user file of a member: `path` relative to the `.vmxblock` file (with `/`), or absolute. */
const vmxBlockFileRefSchema = z.object({
  path: z.string().min(1).describe('Relative to the .vmxblock file (with "/" separators), or absolute'),
});

/** Members' times are relative to the block: no clip anchors (the block's anchor isn't part of a template). */
const vmxBlockMemberAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absolute'), time: z.number().nonnegative().describe('Seconds from the start of the block') }),
  z.object({
    kind: z.literal('element'),
    elementId: z.string().min(1).describe('Id of another member of the block'),
    edge: z.enum(['start', 'end']),
    offset: z.number().describe('Seconds, may be negative'),
  }),
]);

const withMemberAnchor = { anchor: vmxBlockMemberAnchorSchema };

const vmxBlockMemberSchema = z.discriminatedUnion('type', [
  imageOverlaySchema.omit({ absolutePath: true }).extend({ ...withMemberAnchor, path: vmxBlockFileRefSchema.shape.path }),
  countdownOverlaySchema.extend({ ...withMemberAnchor, font: vmxBlockFileRefSchema.optional() }),
  progressBarOverlaySchema.extend({ ...withMemberAnchor, linkedCountdownId: z.string().min(1).optional().describe('Id of a countdown member: the bar takes its start and duration') }),
  soundOverlaySchema.omit({ absolutePath: true }).extend({ ...withMemberAnchor, path: vmxBlockFileRefSchema.shape.path }),
  textOverlaySchema.extend({ ...withMemberAnchor, font: vmxBlockFileRefSchema.optional() }),
]);

export type VmxBlockMember = z.infer<typeof vmxBlockMemberSchema>;

/** Contents of a `.vmxblock` file (version 1). */
export const vmxBlockFileSchema = z.object({
  $schema: z.string().optional().describe('For editors (autocompletion); ignored by VideoMix'),
  format: z.literal(VMXBLOCK_FORMAT),
  version: z.literal(VMXBLOCK_VERSION),
  name: z.string(),
  color: z.number().int().nonnegative().optional().describe('Index into the segment color palette (default 0)'),
  aspect: z.enum(mixOutputAspects).describe('Output aspect the block was made for (VideoMix offers to adapt it to another one)'),
  originalStart: z.number().describe('Start of the block in the video it was exported from (s)'),
  clipAnchor: z.object({ clipName: z.string(), edge: z.enum(['start', 'end']), offset: z.number() }).optional()
    .describe('Informative: the block was anchored to this clip of the project it was exported from'),
  variables: z.record(z.string(), z.string()).optional().describe('Values of the text variables ({{name}}), offered when importing'),
  members: vmxBlockMemberSchema.array().min(1).describe('Overlays of the block, in layer order (the last one on top). Ids only need to be unique inside the file'),
}).superRefine((file, ctx) => {
  const ids = new Set<string>();
  const types = new Map(file.members.map((m) => [m.id, m.type]));
  file.members.forEach((member, index) => {
    if (ids.has(member.id)) ctx.addIssue({ code: 'custom', path: ['members', index, 'id'], message: `Duplicate member id "${member.id}"` });
    if (member.id.includes(BLOCK_MEMBER_ID_SEPARATOR)) ctx.addIssue({ code: 'custom', path: ['members', index, 'id'], message: `A member id can't contain "${BLOCK_MEMBER_ID_SEPARATOR}"` });
    ids.add(member.id);
    if (member.anchor.kind === 'element' && !types.has(member.anchor.elementId)) {
      ctx.addIssue({ code: 'custom', path: ['members', index, 'anchor', 'elementId'], message: `No member with id "${member.anchor.elementId}"` });
    }
    if (member.type === 'progressBar' && member.linkedCountdownId != null && types.get(member.linkedCountdownId) !== 'countdown') {
      ctx.addIssue({ code: 'custom', path: ['members', index, 'linkedCountdownId'], message: `No countdown member with id "${member.linkedCountdownId}"` });
    }
  });
});

export type VmxBlockFile = z.infer<typeof vmxBlockFileSchema>;

/** JSON Schema (draft-07, for editors) of `.vmxblock` files, generated from {@link vmxBlockFileSchema}. */
export function getVmxBlockJsonSchema() {
  return {
    ...z.toJSONSchema(vmxBlockFileSchema, { target: 'draft-7', io: 'input' }),
    title: 'VideoMix block (.vmxblock)',
    description: 'A block of overlays exported from VideoMix, to import into another project. Times are relative to the start of the block.',
  };
}

/** A problem of a `.vmxblock` file: `path` like `members[2].box.width` (empty for the whole file). */
export interface VmxBlockIssue { path: string, message: string }

/** The file couldn't be read: nothing is imported. `issues` has every problem found (field and reason). */
export class VmxBlockParseError extends Error {
  issues: VmxBlockIssue[];

  constructor(issues: VmxBlockIssue[]) {
    super(issues.map(({ path, message }) => (path !== '' ? `${path}: ${message}` : message)).join('\n'));
    this.name = 'VmxBlockParseError';
    this.issues = issues;
  }
}

/** `['members', 2, 'box', 'width']` → `members[2].box.width`. */
export const formatIssuePath = (path: readonly PropertyKey[]) => path.reduce<string>((acc, key) => (typeof key === 'number' ? `${acc}[${key}]` : `${acc}${acc !== '' ? '.' : ''}${String(key)}`), '');

/** A parsed `.vmxblock`, ready to preview and to place (see {@link instantiateVmxBlock}). */
export interface VmxBlockTemplate {
  name: string,
  color: number,
  aspect: MixOutputAspect,
  originalStart: number,
  clipAnchor: VmxBlockFile['clipAnchor'],
  /** The file's values, then the texts' defaults for the other variables: what the import form starts with. */
  variables: Record<string, string>,
  /** Variables found in the texts (name and default), for the import form. */
  variableNames: string[],
  /** Members as overlays (block-relative anchors), with their files resolved by `resolveFile`. */
  members: MixOverlay[],
  /** Length of the block without its sounds' tails (`getBlockDefDuration`). */
  duration: number,
}

/**
 * Reads a `.vmxblock` (JSON5). `resolveFile` turns a stored path (relative to the file, or absolute) into the overlay
 * file to use (e.g. both paths absolute; existence is checked by the caller). Throws {@link VmxBlockParseError} with
 * every problem (JSON syntax with its line and column, or schema/reference errors with their field path).
 */
export function parseVmxBlockFile(text: string, { resolveFile }: { resolveFile: (path: string, kind: OverlayFileKind) => OverlayFile }): VmxBlockTemplate {
  let json: unknown;
  try {
    json = JSON5.parse(text);
  } catch (err) {
    throw new VmxBlockParseError([{ path: '', message: err instanceof Error ? err.message : String(err) }]);
  }
  // A clearer message than a list of mismatches for something that isn't a block at all, or is from a newer version
  const { format, version } = typeof json === 'object' && json != null && !Array.isArray(json) ? json as Record<string, unknown> : {};
  if (format !== VMXBLOCK_FORMAT) throw new VmxBlockParseError([{ path: 'format', message: `Not a VideoMix block file (expected "${VMXBLOCK_FORMAT}")` }]);
  if (typeof version === 'number' && version > VMXBLOCK_VERSION) throw new VmxBlockParseError([{ path: 'version', message: `Version ${version} is newer than supported (${VMXBLOCK_VERSION})` }]);
  const parsed = vmxBlockFileSchema.safeParse(json);
  if (!parsed.success) throw new VmxBlockParseError(parsed.error.issues.map((issue) => ({ path: formatIssuePath(issue.path), message: issue.message })));
  const file = parsed.data;

  const members = file.members.map((member): MixOverlay => {
    switch (member.type) {
      case 'image':
      case 'sound': {
        return { ...member, ...resolveFile(member.path, 'media') };
      }
      case 'countdown':
      case 'text': {
        const { font, ...rest } = member;
        return font != null ? { ...rest, font: resolveFile(font.path, 'font') } : rest;
      }
      default: {
        return member;
      }
    }
  });
  const variableList = getBlockDefVariables({ members });
  const defaults = Object.fromEntries(variableList.map(({ name, defaultValue }) => [name, defaultValue ?? '']));
  return {
    name: file.name,
    color: file.color ?? 0,
    aspect: file.aspect,
    originalStart: file.originalStart,
    clipAnchor: file.clipAnchor,
    variables: { ...defaults, ...file.variables },
    variableNames: variableList.map(({ name }) => name),
    members,
    duration: getBlockDefDuration({ members }),
  };
}

/**
 * The contents of a `.vmxblock` for definition `def` (its members' invalid references normalized, see
 * `getNormalizedMembers`). `toFilePath` gives the path to store for each user file (relative to the `.vmxblock`,
 * e.g. into the "include files" folder).
 */
export function createVmxBlockFile({ def, aspect, originalStart, clipAnchor, variables, toFilePath, schema }: {
  def: Pick<MixBlockDef, 'name' | 'color' | 'members'>,
  aspect: MixOutputAspect,
  originalStart: number,
  clipAnchor?: VmxBlockFile['clipAnchor'] | undefined,
  variables?: Readonly<Record<string, string>> | undefined,
  toFilePath: (file: OverlayFile, kind: OverlayFileKind, member: MixOverlay) => string,
  /** `$schema` (a path or URL of vmxblock.schema.json), for editors. */
  schema?: string | undefined,
}): VmxBlockFile {
  const members = getNormalizedMembers(def).map((member): VmxBlockMember => {
    if (member.type === 'image' || member.type === 'sound') {
      return { ...omit(member, 'absolutePath'), path: toFilePath(member, 'media', member) } as VmxBlockMember;
    }
    if ((member.type === 'countdown' || member.type === 'text') && member.font != null) return { ...member, font: { path: toFilePath(member.font, 'font', member) } } as VmxBlockMember;
    return member as VmxBlockMember;
  });
  return {
    ...(schema != null && { $schema: schema }),
    format: VMXBLOCK_FORMAT,
    version: VMXBLOCK_VERSION,
    name: def.name,
    color: def.color,
    aspect,
    originalStart,
    ...(clipAnchor != null && { clipAnchor }),
    ...(variables != null && Object.keys(variables).length > 0 && { variables: { ...variables } }),
    members,
  };
}

/** Indented strict JSON (what the app writes; it reads JSON5). */
export const serializeVmxBlockFile = (file: VmxBlockFile) => `${JSON.stringify(file, null, 2)}\n`;

/** H2: where to place an imported block. */
export type VmxBlockPlacement =
  /** At its `originalStart` (≥ 0). */
  | { kind: 'original' }
  /** At `originalStart + seconds` (≥ 0). */
  | { kind: 'shift', seconds: number }
  /** At `time` of the final video (e.g. the Mix view cursor). */
  | { kind: 'cursor', time: number }
  /** Anchored to a clip of the project. */
  | { kind: 'clip', clipId: string, edge: 'start' | 'end', offset: number };

export function getVmxBlockPlacementAnchor(template: Pick<VmxBlockTemplate, 'originalStart'>, placement: VmxBlockPlacement): OverlayAnchor {
  switch (placement.kind) {
    case 'original': { return { kind: 'absolute', time: Math.max(0, template.originalStart) }; }
    case 'shift': { return { kind: 'absolute', time: Math.max(0, template.originalStart + placement.seconds) }; }
    case 'cursor': { return { kind: 'absolute', time: Math.max(0, placement.time) }; }
    case 'clip': { return { kind: 'clip', clipId: placement.clipId, edge: placement.edge, offset: placement.offset }; }
    default: {
      const exhaustive: never = placement;
      throw new Error(`Unknown placement ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * H2/H7: a template as a new definition and instance (new ids always, so a file can be imported many times), for an
 * `addBlocks` action (or `addBlocks` + `ungroupBlock` in a batch to import it ungrouped). With `adaptTo` (the project's
 * aspect, when "Adapt" is checked), the boxes are adapted (`adaptBlockDefToAspect`). `variables`: the import form's
 * values (default: the template's), stored as given.
 */
export function instantiateVmxBlock(template: VmxBlockTemplate, { defId, blockId, placement, variables, adaptTo }: {
  defId: string,
  blockId: string,
  placement: VmxBlockPlacement,
  variables?: Readonly<Record<string, string>> | undefined,
  adaptTo?: MixOutputAspect | undefined,
}): { def: MixBlockDef, block: MixBlock } {
  let def: MixBlockDef = { id: defId, name: template.name, color: template.color, members: structuredClone(template.members) };
  if (adaptTo != null) def = adaptBlockDefToAspect(def, template.aspect, adaptTo);
  const values = variables ?? template.variables;
  const block: MixBlock = {
    id: blockId,
    defId,
    anchor: getVmxBlockPlacementAnchor(template, placement),
    ...(Object.keys(values).length > 0 && { variables: { ...values } }),
  };
  return { def, block };
}

/** What {@link createVmxBlockFile} needs from the project, see {@link getBlockExport} and {@link getOverlaysExport}. */
export interface VmxBlockExport {
  def: Pick<MixBlockDef, 'name' | 'color' | 'members'>,
  aspect: MixOutputAspect,
  originalStart: number,
  clipAnchor: VmxBlockFile['clipAnchor'],
  variables: Record<string, string> | undefined,
}

const getClipAnchorInfo = (project: Pick<MixProject, 'clips'>, anchor: OverlayAnchor): VmxBlockFile['clipAnchor'] => (anchor.kind === 'clip'
  ? { clipName: project.clips.find((c) => c.id === anchor.clipId)?.name ?? anchor.clipId, edge: anchor.edge, offset: anchor.offset }
  : undefined);

/** H2 "Export" of block `blockId`. `times`: `resolveProjectTimes` (its start is the `originalStart`). */
export function getBlockExport(project: MixProject, blockId: string, times: ProjectTimes): VmxBlockExport | undefined {
  const block = project.blocks.find((b) => b.id === blockId);
  const def = project.blockDefs.find((d) => d.id === block?.defId);
  if (block == null || def == null) return undefined;
  return {
    def,
    aspect: project.settings.output.aspect,
    originalStart: times.get(blockId)?.rawStart ?? (block.anchor.kind === 'absolute' ? block.anchor.time : 0),
    clipAnchor: getClipAnchorInfo(project, block.anchor),
    variables: block.variables,
  };
}

/** H2 "Export selection" of loose overlays, as if grouped into a block (`buildBlockFromOverlays`). */
export function getOverlaysExport(project: MixProject, overlayIds: readonly string[], times: ProjectTimes, { name, color = 0 }: { name: string, color?: number }): VmxBlockExport | undefined {
  const built = buildBlockFromOverlays(project.overlays, overlayIds, times, { defId: 'export', name, color });
  if (built == null) return undefined;
  return { def: built.def, aspect: project.settings.output.aspect, originalStart: built.start, clipAnchor: getClipAnchorInfo(project, built.anchor), variables: undefined };
}
