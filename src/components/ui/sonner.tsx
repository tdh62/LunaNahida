import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

function closeClickedToast(event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) {
  if (event.defaultPrevented || !(event.target instanceof Element)) return;
  if (event.target.closest('button, a, input, select, textarea, [role="button"], [contenteditable="true"]')) return;
  const notification = event.target.closest<HTMLElement>('[data-sonner-toast]');
  if (!notification || notification.dataset.dismissible === 'false' || notification.dataset.type === 'loading' || notification.dataset.removed === 'true') return;
  if ('key' in event) {
    if (event.target !== notification || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
  }
  if (window.getSelection()?.toString()) return;
  // Let Sonner close the toast so its animation and onDismiss callback are preserved.
  notification.querySelector<HTMLButtonElement>('[data-close-button]')?.click();
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <div onClick={closeClickedToast} onKeyDown={closeClickedToast}>
      <Sonner
        closeButton
        position="top-right"
        offset={40}
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        toastOptions={{
          classNames: {
            toast:
              "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
            description: "group-[.toast]:text-muted-foreground",
            actionButton:
              "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
            cancelButton:
              "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          },
        }}
        {...props}
      />
    </div>
  );
};

export { Toaster };
