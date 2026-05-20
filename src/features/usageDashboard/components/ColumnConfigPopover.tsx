import { useTranslation } from 'react-i18next';

interface ColumnDef {
  key: string;
  labelKey: string;
  hideable: boolean;
}

interface ColumnConfigPopoverProps {
  columns: ColumnDef[];
  visibleColumns: string[];
  onChange: (cols: string[]) => void;
  onClose: () => void;
}

export function ColumnConfigPopover({
  columns,
  visibleColumns,
  onChange,
  onClose,
}: ColumnConfigPopoverProps) {
  const { t } = useTranslation();

  const toggle = (key: string) => {
    if (visibleColumns.includes(key)) {
      if (visibleColumns.length <= 2) return;
      onChange(visibleColumns.filter((k) => k !== key));
    } else {
      onChange([...visibleColumns, key]);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 4,
        background: 'var(--bg-primary, #fff)',
        border: '1px solid var(--border-color, #e5e5e5)',
        borderRadius: 6,
        padding: '8px 12px',
        boxShadow: '0 4px 12px rgb(0 0 0 / 0.1)',
        zIndex: 100,
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary, #6b7280)' }}>
        {t('usage_dashboard.visible_columns')}
      </div>
      {columns.map((col) => (
        <label
          key={col.key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 0',
            fontSize: 12,
            cursor: col.hideable ? 'pointer' : 'default',
            color: col.hideable ? 'var(--text-primary, #111827)' : 'var(--text-tertiary, #9ca3af)',
          }}
        >
          <input
            type="checkbox"
            checked={visibleColumns.includes(col.key)}
            onChange={() => toggle(col.key)}
            disabled={!col.hideable}
          />
          {t(col.labelKey)}
        </label>
      ))}
      <div style={{ marginTop: 8, textAlign: 'right' }}>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: 'none',
            fontSize: 11,
            color: 'var(--text-secondary, #6b7280)',
            cursor: 'pointer',
          }}
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
