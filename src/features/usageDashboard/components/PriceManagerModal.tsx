import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { UsageStatsGroupRow, PriceEntry } from '@/types/usageStats';
import styles from './PriceManagerModal.module.scss';

interface PriceManagerModalProps {
  open: boolean;
  onClose: () => void;
  modelRows: UsageStatsGroupRow[];
  priceTable: PriceEntry[];
  onUpdateEntry: (model: string, input: number, cacheHit: number, output: number) => void;
  onRemoveEntry: (model: string) => void;
  onClearAll: () => void;
}

export function PriceManagerModal({
  open,
  onClose,
  modelRows,
  priceTable,
  onUpdateEntry,
  onRemoveEntry,
  onClearAll,
}: PriceManagerModalProps) {
  const { t } = useTranslation();

  const allModels = useMemo(() => {
    const set = new Set<string>();
    modelRows.forEach((r) => set.add(r.label));
    priceTable.forEach((p) => set.add(p.model));
    return Array.from(set).sort();
  }, [modelRows, priceTable]);

  const [editValues, setEditValues] = useState<Record<string, { input: string; cacheHit: string; output: string }>>({});

  const getPrice = (model: string) => {
    const entry = priceTable.find((p) => p.model === model);
    const edit = editValues[model];
    return {
      input: edit?.input ?? (entry?.inputPricePerM?.toString() ?? ''),
      cacheHit: edit?.cacheHit ?? (entry?.cacheHitPricePerM?.toString() ?? ''),
      output: edit?.output ?? (entry?.outputPricePerM?.toString() ?? ''),
    };
  };

  const handleChange = (model: string, field: 'input' | 'cacheHit' | 'output', value: string) => {
    setEditValues((prev) => ({
      ...prev,
      [model]: { ...getPrice(model), [field]: value },
    }));
  };

  const handleSave = (model: string) => {
    const vals = getPrice(model);
    onUpdateEntry(model, parseFloat(vals.input) || 0, parseFloat(vals.cacheHit) || 0, parseFloat(vals.output) || 0);
    setEditValues((prev) => {
      const next = { ...prev };
      delete next[model];
      return next;
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('usage_dashboard.manage_prices')}
      width={720}
      footer={
        <div className={styles.footer}>
          <Button size="sm" onClick={onClearAll}>
            {t('usage_dashboard.clear_all_prices')}
          </Button>
          <Button size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className={styles.hint}>{t('usage_dashboard.price_hint')}</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('usage_stats.col_model')}</th>
            <th>{t('usage_dashboard.input_price')}</th>
            <th>{t('usage_dashboard.cache_hit_price')}</th>
            <th>{t('usage_dashboard.output_price')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {allModels.map((model) => {
            const vals = getPrice(model);
            return (
              <tr key={model}>
                <td className={styles.modelCell} title={model}>{model}</td>
                <td>
                  <input
                    type="number"
                    className={styles.input}
                    value={vals.input}
                    onChange={(e) => handleChange(model, 'input', e.target.value)}
                    placeholder="0"
                    step="0.01"
                    min="0"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className={styles.input}
                    value={vals.cacheHit}
                    onChange={(e) => handleChange(model, 'cacheHit', e.target.value)}
                    placeholder="0"
                    step="0.01"
                    min="0"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className={styles.input}
                    value={vals.output}
                    onChange={(e) => handleChange(model, 'output', e.target.value)}
                    placeholder="0"
                    step="0.01"
                    min="0"
                  />
                </td>
                <td>
                  <div className={styles.actions}>
                    <button className={styles.saveBtn} onClick={() => handleSave(model)}>
                      {t('common.save')}
                    </button>
                    <button className={styles.delBtn} onClick={() => onRemoveEntry(model)}>
                      {t('common.delete')}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {allModels.length === 0 && (
            <tr>
              <td colSpan={5} className={styles.empty}>
                {t('usage_dashboard.no_models_for_pricing')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Modal>
  );
}
