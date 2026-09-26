import type { CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { FaFileImport, FaThLarge } from 'react-icons/fa';

import type { UseBlockTemplates } from '../hooks/useBlockTemplates';

/** "Insert block…" (the template library) and "Import block…" (a .vmxblock file) in the Mix view toolbar (H2, H3, T58). */
function BlockTemplateButtons({ blockTemplates, buttonStyle }: {
  blockTemplates: Pick<UseBlockTemplates, 'userInsertBlockFromLibrary' | 'userImportBlock'>,
  buttonStyle: CSSProperties,
}) {
  const { t } = useTranslation();
  return (
    <>
      <button type="button" style={buttonStyle} onClick={blockTemplates.userInsertBlockFromLibrary} title={t('Inserts a block of the template library')}><FaThLarge />{t('Insert block…')}</button>
      <button type="button" style={buttonStyle} onClick={blockTemplates.userImportBlock} title={t('Imports a block from a .vmxblock file')}><FaFileImport />{t('Import block…')}</button>
    </>
  );
}

export default memo(BlockTemplateButtons);
