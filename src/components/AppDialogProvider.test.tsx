import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppDialogSurface, dialogCanSubmit, type AppDialogRequest } from "./AppDialogProvider";

const noop = () => undefined;

function confirmRequest(): AppDialogRequest {
  return {
    kind: "confirm",
    options: {
      title: "Archive Workspace",
      description: "Data will be preserved.",
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
      severity: "warning",
    },
    resolve: () => undefined,
  };
}

describe("AppDialogProvider surface", () => {
  it("renders shared confirm and cancel actions", () => {
    const request = confirmRequest();
    const html = renderToStaticMarkup(<AppDialogSurface request={request} inputValue="" phraseValue="" busy={false} error={null} onInputChange={noop} onPhraseChange={noop} onCancel={noop} onSubmit={noop} />);
    expect(html).toContain("Archive Workspace");
    expect(html).toContain("Data will be preserved.");
    expect(html).toContain(">Archive<");
    expect(html).toContain(">Cancel<");
    expect(html).toContain("app-dialog-warning");
  });

  it("renders prompt input with its initial value", () => {
    const request: AppDialogRequest = {
      kind: "prompt",
      options: { title: "Rename", inputLabel: "Workspace name", initialValue: "Workspace 1", inputRequired: true, confirmLabel: "Rename", cancelLabel: "Cancel" },
      resolve: () => undefined,
    };
    const html = renderToStaticMarkup(<AppDialogSurface request={request} inputValue="Workspace 1" phraseValue="" busy={false} error={null} onInputChange={noop} onPhraseChange={noop} onCancel={noop} onSubmit={noop} />);
    expect(html).toContain("Workspace name");
    expect(html).toContain('value="Workspace 1"');
    expect(dialogCanSubmit(request, "", "", false)).toBe(false);
    expect(dialogCanSubmit(request, "New name", "", false)).toBe(true);
  });

  it("requires an exact destructive confirmation phrase", () => {
    const request: AppDialogRequest = {
      kind: "confirm",
      options: { title: "Delete permanently", confirmLabel: "Delete", cancelLabel: "Cancel", severity: "destructive", requiredPhrase: "DELETE", requiredPhraseLabel: "Type DELETE" },
      resolve: () => undefined,
    };
    expect(dialogCanSubmit(request, "", "delete", false)).toBe(false);
    expect(dialogCanSubmit(request, "", "DELETE", false)).toBe(true);
    const html = renderToStaticMarkup(<AppDialogSurface request={request} inputValue="" phraseValue="DELETE" busy={false} error={null} onInputChange={noop} onPhraseChange={noop} onCancel={noop} onSubmit={noop} />);
    expect(html).toContain("app-dialog-destructive");
    expect(html).toContain("Type DELETE");
  });

  it("disables confirmation while an async action is busy and shows the busy label", () => {
    const request: AppDialogRequest = {
      kind: "confirm",
      options: { title: "Restore backup", confirmLabel: "Restore", busyLabel: "Restoring…", cancelLabel: "Cancel" },
      resolve: () => undefined,
    };
    expect(dialogCanSubmit(request, "", "", true)).toBe(false);
    const html = renderToStaticMarkup(<AppDialogSurface request={request} inputValue="" phraseValue="" busy error={null} onInputChange={noop} onPhraseChange={noop} onCancel={noop} onSubmit={noop} />);
    expect(html).toContain("Restoring…");
    expect(html).toContain("disabled");
  });

  it("keeps async errors visible inside the shared modal", () => {
    const request = confirmRequest();
    const html = renderToStaticMarkup(<AppDialogSurface request={request} inputValue="" phraseValue="" busy={false} error="Database refused the operation" onInputChange={noop} onPhraseChange={noop} onCancel={noop} onSubmit={noop} />);
    expect(html).toContain("Database refused the operation");
    expect(html).toContain('role="alert"');
  });

  it("supports information-only dialogs without a cancel action", () => {
    const request: AppDialogRequest = { kind: "information", options: { title: "Completed", description: "Operation finished.", confirmLabel: "OK" }, resolve: () => undefined };
    const html = renderToStaticMarkup(<AppDialogSurface request={request} inputValue="" phraseValue="" busy={false} error={null} onInputChange={noop} onPhraseChange={noop} onCancel={noop} onSubmit={noop} />);
    expect(html).toContain("Completed");
    expect(html).toContain(">OK<");
    expect(html).not.toContain(">Cancel<");
  });
});
