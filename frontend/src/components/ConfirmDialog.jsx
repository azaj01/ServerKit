import { useState, useEffect } from 'react';
import { AlertTriangle, Info, AlertCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const iconMap = { danger: AlertTriangle, warning: AlertCircle, info: Info };
const iconColor = { danger: 'text-destructive', warning: 'text-yellow-400', info: 'text-blue-400' };

export function ConfirmDialog({
  isOpen,
  title,
  message,
  details,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  requireConfirmation,
  confirmationPlaceholder,
  onConfirm,
  onCancel,
}) {
  const [inputValue, setInputValue] = useState('');

  useEffect(() => { if (isOpen) setInputValue(''); }, [isOpen]);

  const Icon = iconMap[variant] || AlertTriangle;
  const isConfirmDisabled = requireConfirmation && inputValue !== requireConfirmation;

  return (
    <AlertDialog open={isOpen} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className={cn('mb-1', iconColor[variant] || 'text-destructive')}>
              <Icon size={32} />
            </div>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {message && <AlertDialogDescription>{message}</AlertDialogDescription>}
            {details && <p className="text-sm text-muted-foreground">{details}</p>}
            {requireConfirmation && (
              <div className="w-full text-left mt-2 space-y-1.5">
                <Label className="text-muted-foreground">
                  Type <strong className="text-foreground">{requireConfirmation}</strong> to confirm:
                </Label>
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isConfirmDisabled && onConfirm()}
                  placeholder={confirmationPlaceholder || requireConfirmation}
                  autoFocus
                />
              </div>
            )}
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isConfirmDisabled}
            className={cn(variant !== 'danger' && 'bg-primary hover:bg-primary/90')}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmDialog;
