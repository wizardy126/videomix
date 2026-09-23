export const homepageUrl = 'https://losslesscut.app/';
// VideoMix (T17): "Source code" and the about panel point to the VideoMix fork, not upstream LosslessCut
export const githubUrl = 'https://github.com/wizardy126/videomix/';
export const getReleaseUrl = (version: string) => `https://github.com/mifi/lossless-cut/releases/tag/v${version}`;
export const compareReleasesUrl = (fromVersion: string, toVersion: string) => `https://github.com/mifi/lossless-cut/compare/v${fromVersion}...v${toVersion}`;
// VideoMix (T17): "User manual", opens docs/videomix/manual-usuario.md on the branch the project is developed on (01-requisitos §8 W1)
export const userManualUrl = `${githubUrl}blob/claude/videomix-analysis-planning-97c8lp/docs/videomix/manual-usuario.md`;
export const licensesUrl = 'https://losslesscut.mifi.no/licenses.txt';
export const thanksUrl = 'https://mifi.no/thanks';
export const discussionsUrl = 'https://mifi.no/losslesscut/discussions';
export const usageUrl = 'https://mifi.no/losslesscut/usage';
export const faqUrl = 'https://mifi.no/losslesscut/faq';
export const featureRequestUrl = 'https://mifi.no/losslesscut/feature-request';
export const publicBugReportUrl = 'https://mifi.no/losslesscut/bug-report';
export const troubleshootingUrl = 'https://mifi.no/losslesscut/troubleshooting';
// Note: https://github.com/mifi/lossless-cut/blob/master/docs/file-name-template.md used to be https://github.com/mifi/lossless-cut/blob/master/docs.md#custom-exported-file-names
export const exportedFileNameTemplateHelpUrl = 'https://mifi.no/losslesscut/file-name-template';
export const selectSegmentByExpressionHelpUrl = 'https://mifi.no/losslesscut/select-segments-by-expression';
export const editSegmentByExpressionHelpUrl = 'https://mifi.no/losslesscut/edit-segments-by-expression';
export const changeEnabledStreamsExpressionHelpUrl = 'https://mifi.no/losslesscut/select-tracks-by-expression';
export const supportEmail = 'losslesscut@mifi.no';
