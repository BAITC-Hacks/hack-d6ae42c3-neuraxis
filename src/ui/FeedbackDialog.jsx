import { useEffect, useRef } from 'react';

export default function FeedbackDialog({ title, children, onClose, onConfirm, confirmLabel = 'Продолжить', busy = false }) {
  const dialog = useRef(null);
  useEffect(() => { const el = dialog.current; el.showModal(); return () => el.close(); }, []);
  return <dialog className="feedback-dialog" ref={dialog} aria-labelledby="feedback-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div className="feedback-content"><h2 id="feedback-title">{title}</h2><div className="feedback-body">{children}</div><div className="feedback-actions">{onConfirm && <button className="button secondary" disabled={busy} onClick={onClose}>Отмена</button>}<button autoFocus className="button primary" disabled={busy} onClick={onConfirm || onClose}>{busy ? 'Подготавливаем отчёт…' : confirmLabel}</button></div></div>
  </dialog>;
}
