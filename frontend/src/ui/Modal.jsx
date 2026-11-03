import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";
import { Button, IconButton } from "./Button";

/**
 * Dialog built on native <dialog>.showModal(): the browser traps focus, closes on Escape,
 * makes the page behind inert and restores focus on close. Controlled with `open` + `onClose`.
 */
export function Modal({ open, onClose, title, children, footer, className }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => open && onClose()}
      onClick={(e) => e.target === ref.current && onClose()} // backdrop click
      className={cx(
        "m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/50",
        "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
        className,
      )}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
          </div>
          <div className="text-sm text-zinc-600 dark:text-zinc-300">{children}</div>
          {footer && <div className="flex justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** "Delete meeting?" style confirmation. Cancel gets focus first so Enter never deletes by accident. */
export function ConfirmDialog({ open, title, children, confirmLabel = "Delete", danger = true, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
