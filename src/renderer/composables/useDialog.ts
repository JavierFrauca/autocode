import { createApp, defineComponent, h, ref } from "vue";
import AppDialog from "../components/AppDialog.vue";

interface DialogOptions {
  title: string;
  message: string;
  type?: "confirm" | "alert" | "danger";
  confirmLabel?: string;
  cancelLabel?: string;
}

function openDialog(opts: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    function cleanup(result: boolean) {
      app.unmount();
      container.remove();
      resolve(result);
    }

    const app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(AppDialog, {
              ...opts,
              onConfirm: () => cleanup(true),
              onCancel:  () => cleanup(false),
            });
        },
      }),
    );

    app.mount(container);
  });
}

export function useDialog() {
  return {
    confirm: (title: string, message: string, opts?: Pick<DialogOptions, "confirmLabel" | "cancelLabel">) =>
      openDialog({ title, message, type: "confirm", ...opts }),

    danger: (title: string, message: string, opts?: Pick<DialogOptions, "confirmLabel" | "cancelLabel">) =>
      openDialog({ title, message, type: "danger", confirmLabel: "Borrar", ...opts }),

    alert: (title: string, message: string) =>
      openDialog({ title, message, type: "alert" }),
  };
}
