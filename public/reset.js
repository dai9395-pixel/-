// Pure transformations. Backups stay in the existing private staff JSON record.
export function resetRecord(record, options) {
  if (record.reset_backup) throw Error('前回のリセットを先に元に戻してください。');
  const data = structuredClone(record);
  const before = {}, after = {};
  const capture = (key, value) => {
    if (JSON.stringify(data[key]) === JSON.stringify(value)) return;
    before[key] = structuredClone(data[key] ?? null);
    data[key] = value;
    after[key] = structuredClone(value);
  };
  if (options.sales || options.targets || options.customers) {
    capture('sales', data.sales.map(row => {
      const included = options.period === 'all' ||
        (options.period === 'past' ? row.month < options.month : row.month === options.month);
      if (!included) return row;
      return {...row, ...(options.sales ? {actual: 0, nominated: 0} : {}),
        ...(options.targets ? {target: 0} : {}), ...(options.customers ? {customers: 0} : {})};
    }));
  }
  if (options.goals) {
    for (const key of ['annual', 'monthly', 'challenge', 'action']) capture(key, '');
    capture('progress', 0);
  }
  if (Object.keys(before).length) data.reset_backup = {before, after, at: new Date().toISOString()};
  return data;
}
export function restoreRecord(record) {
  const data = structuredClone(record), backup = data.reset_backup;
  if (!backup) throw Error('元に戻せるリセットがありません。');
  for (const key of Object.keys(backup.before)) {
    if (!['sales','annual','monthly','challenge','action','progress'].includes(key)) throw Error('復元データを確認してください。');
    if (JSON.stringify(data[key]) !== JSON.stringify(backup.after[key]))
      throw Error('リセット後に売上や目標が編集されています。上書きを防ぐため復元を中止しました。');
    data[key] = structuredClone(backup.before[key]);
  }
  delete data.reset_backup;
  return data;
}
