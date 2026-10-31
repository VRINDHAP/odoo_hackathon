import React from 'react';
import { Check, Circle, X } from 'lucide-react';
import { evaluatePasswordStrength } from '../../utils/validation';

/* --- Button Primitive --- */
export type ButtonVariant = 'primary' | 'outline' | 'sand' | 'ink' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  isLoading?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn btn-cta-chip',
  outline: 'btn btn-outline',
  sand: 'btn btn-secondary-sand',
  ink: 'btn btn-ink-soft',
  danger: 'btn btn-danger-outline',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'outline',
  isLoading = false,
  disabled,
  children,
  className = '',
  ...rest
}) => (
  <button
    className={`${VARIANT_CLASS[variant]} ${className}`.trim()}
    disabled={disabled || isLoading}
    {...rest}
  >
    {isLoading ? 'Working…' : children}
  </button>
);

/* --- FormInput Primitive --- */
interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
  rightHint?: React.ReactNode;
}

export const FormInput: React.FC<FormInputProps> = ({
  label,
  error,
  helperText,
  rightHint,
  id,
  className = '',
  ...rest
}) => {
  const inputId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="form-field">
      <label htmlFor={inputId} className="form-label">
        <span>{label}</span>
        {rightHint}
      </label>
      <input
        id={inputId}
        className={`form-input ${error ? 'form-input-error' : ''} ${className}`.trim()}
        aria-invalid={Boolean(error)}
        {...rest}
      />
      {error ? (
        <span className="form-error-text" role="alert">
          {error}
        </span>
      ) : helperText ? (
        <span className="form-helper-text">{helperText}</span>
      ) : null}
    </div>
  );
};

/* --- FormSelect Primitive --- */
interface SelectOption {
  value: string;
  label: string;
}

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  error?: string;
}

export const FormSelect: React.FC<FormSelectProps> = ({
  label,
  options,
  error,
  id,
  ...rest
}) => {
  const selectId = id ?? `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="form-field">
      <label htmlFor={selectId} className="form-label">
        <span>{label}</span>
      </label>
      <select
        id={selectId}
        className={`form-select ${error ? 'form-input-error' : ''}`.trim()}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="form-error-text" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
};

/* --- FormTextarea Primitive --- */
interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

export const FormTextarea: React.FC<FormTextareaProps> = ({ label, error, id, ...rest }) => {
  const textId = id ?? `textarea-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="form-field">
      <label htmlFor={textId} className="form-label">
        <span>{label}</span>
      </label>
      <textarea
        id={textId}
        rows={3}
        className={`form-textarea ${error ? 'form-input-error' : ''}`.trim()}
        {...rest}
      />
      {error ? (
        <span className="form-error-text" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
};

/* --- ToggleSwitch Primitive --- */
interface ToggleSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  label,
  description,
  checked,
  disabled,
  onChange,
}) => (
  <label
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '10px 12px',
      borderRadius: 'var(--rounded-md)',
      border: '1px solid var(--color-hairline)',
      backgroundColor: 'var(--color-canvas)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="type-body-sm">{label}</span>
      {description ? <span className="form-helper-text">{description}</span> : null}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 38,
        height: 22,
        borderRadius: 9999,
        padding: 2,
        border: '1px solid var(--color-hairline-strong)',
        backgroundColor: checked ? 'var(--color-primary)' : 'var(--color-canvas-sand)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background-color 0.15s ease',
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: 'var(--color-ink)',
        }}
      />
    </button>
  </label>
);

/* --- Modal Primitive --- */
interface ModalProps {
  isOpen: boolean;
  title: string;
  eyebrow?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  maxWidth?: number;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  title,
  eyebrow,
  onClose,
  footer,
  maxWidth = 540,
  children,
}) => {
  if (!isOpen) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel" style={{ maxWidth }}>
        <div className="modal-header">
          <div>
            {eyebrow ? <div className="eyebrow-cap">{eyebrow}</div> : null}
            <h2 className="type-heading">{title}</h2>
          </div>
          <button
            type="button"
            className="btn btn-secondary-sand"
            onClick={onClose}
            aria-label="Close modal"
            style={{ padding: 6 }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
};

/* --- ConfirmModal Primitive (SPEC.md §12.4 Destructive Action Guard) --- */
interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  isLoading = false,
  onConfirm,
  onCancel,
  children,
}) => (
  <Modal
    isOpen={isOpen}
    title={title}
    eyebrow="Confirmation Required"
    onClose={onCancel}
    footer={
      <>
        <Button variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          onClick={onConfirm}
          isLoading={isLoading}
        >
          {confirmLabel}
        </Button>
      </>
    }
  >
    <p className="type-caption" style={{ color: 'var(--color-ink-secondary)' }}>
      {description}
    </p>
    {children}
  </Modal>
);

/* --- SlideOverDrawer Primitive --- */
interface SlideOverDrawerProps {
  isOpen: boolean;
  title: string;
  eyebrow?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const SlideOverDrawer: React.FC<SlideOverDrawerProps> = ({
  isOpen,
  title,
  eyebrow,
  onClose,
  footer,
  children,
}) => {
  if (!isOpen) return null;
  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer-panel">
        <div className="modal-header">
          <div>
            {eyebrow ? <div className="eyebrow-cap">{eyebrow}</div> : null}
            <h2 className="type-heading">{title}</h2>
          </div>
          <button
            type="button"
            className="btn btn-secondary-sand"
            onClick={onClose}
            aria-label="Close drawer"
            style={{ padding: 6 }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="modal-body" style={{ flex: 1 }}>
          {children}
        </div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
};

/* --- Horizontal Lifecycle Stepper (SPEC.md §6.1, §6.2) --- */
interface LifecycleStepperProps {
  steps: string[];
  currentStatus: string;
  branchStatus?: string | null;
}

export const LifecycleStepper: React.FC<LifecycleStepperProps> = ({
  steps,
  currentStatus,
  branchStatus,
}) => {
  const normalizedCurrent = currentStatus.toLowerCase();
  const currentIdx = steps.findIndex((s) => s.toLowerCase() === normalizedCurrent);

  return (
    <div className="lifecycle-stepper" aria-label="Lifecycle status stepper">
      {steps.map((step, index) => {
        const isCurrent = step.toLowerCase() === normalizedCurrent;
        const isCompleted = currentIdx > index;
        return (
          <React.Fragment key={step}>
            <div
              className={`stepper-node ${
                isCurrent ? 'stepper-node-current' : isCompleted ? 'stepper-node-completed' : ''
              }`.trim()}
            >
              {isCompleted ? <Check size={13} /> : <span className="mono-text">{index + 1}</span>}
              <span>{step}</span>
            </div>
            {index < steps.length - 1 ? <span className="stepper-connector" /> : null}
          </React.Fragment>
        );
      })}
      {branchStatus ? (
        <>
          <span className="stepper-connector" />
          <div className="stepper-node stepper-node-current">
            <span>{branchStatus}</span>
          </div>
        </>
      ) : null}
    </div>
  );
};

/* --- Live Password Strength Checklist (SPEC.md §8, §12.4) --- */
export const PasswordChecklist: React.FC<{ password: string }> = ({ password }) => {
  const rules = evaluatePasswordStrength(password);
  const items = [
    { key: 'minLength', label: 'At least 9 characters (> 8 length)', met: rules.minLength },
    { key: 'hasUppercase', label: 'Contains an uppercase letter (A–Z)', met: rules.hasUppercase },
    { key: 'hasLowercase', label: 'Contains a lowercase letter (a–z)', met: rules.hasLowercase },
    { key: 'hasSpecialChar', label: 'Contains a special character (!@#$…)', met: rules.hasSpecialChar },
  ];

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 'var(--rounded-md)',
        backgroundColor: 'var(--color-canvas-cool)',
        border: '1px solid var(--color-hairline)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
      aria-live="polite"
    >
      <span className="eyebrow-cap" style={{ lineHeight: '16px' }}>
        Password Security Checklist
      </span>
      {items.map((item) => (
        <div
          key={item.key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: item.met ? 'var(--chip-active-text)' : 'var(--color-ink-mute-2)',
          }}
        >
          {item.met ? <Check size={14} /> : <Circle size={12} />}
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
};

