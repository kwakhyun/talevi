"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
export default function Modal({
  title,
  onClose,
  children,
  wide = false,
  error = "",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="닫기">
          <X size={22} />
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
