import { Effect } from "effect";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import type { Family } from "../../../shared/schemas.js";
import { Modal } from "../ui/Modal.js";
import { Select } from "../ui/Select.js";
import { Input } from "../ui/Input.js";
import { Button } from "../ui/Button.js";

type QrInviteModalProps = {
  open: boolean;
  onClose: () => void;
  families: Family[];
  onSuccess?: () => void;
};

const NEW_FAMILY_VALUE = "__new__";

export function QrInviteModal({ open, onClose, families, onSuccess }: QrInviteModalProps) {
  const [familyId, setFamilyId] = useState("");
  const [newFamilyName, setNewFamilyName] = useState("");
  const [invitedRole, setInvitedRole] = useState("parent");
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const isNew = familyId === NEW_FAMILY_VALUE;
      const targetId = isNew ? "new" : familyId;
      const body = isNew
        ? {
            name: newFamilyName,
            slug: newFamilyName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, ""),
            invited_role: invitedRole as "parent" | "student",
          }
        : { invited_role: invitedRole as "parent" | "student" };
      return Effect.runPromise(
        api.admin.qrInvite({ params: { familyId: targetId }, payload: body }),
      );
    },
    onSuccess: (data) => {
      if (data) setQrUrl(data.url);
      onSuccess?.();
    },
  });

  const familyOptions = [
    { value: "", label: "Select a family..." },
    ...families.map((f) => ({ value: f.id, label: f.name })),
    { value: NEW_FAMILY_VALUE, label: "Create new family" },
  ];

  const handleClose = () => {
    setFamilyId("");
    setNewFamilyName("");
    setInvitedRole("parent");
    setQrUrl(null);
    generateMutation.reset();
    onClose();
  };

  const canGenerate =
    familyId && (familyId !== NEW_FAMILY_VALUE || newFamilyName.trim().length > 0);

  return (
    <Modal open={open} onClose={handleClose} title="Add via QR Code">
      {qrUrl ? (
        <div className="flex flex-col items-center gap-5" data-testid="qr-invite-result">
          <div className="rounded-xl bg-white p-4">
            <QRCodeSVG value={qrUrl} size={220} />
          </div>
          <p className="max-w-xs text-center text-sm text-muted dark:text-muted-dark">
            Have the student or parent scan this code with their phone camera to create their
            account and join the family.
          </p>
          <p className="text-center text-xs text-muted/60 dark:text-muted-dark/60">
            This code expires in 24 hours.
          </p>
          <Button variant="ghost" onClick={handleClose} data-testid="qr-invite-done">
            Done
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="qr-invite-form">
          <Select
            id="qr-family"
            name="family_id"
            label="Family"
            options={familyOptions}
            value={familyId}
            onChange={setFamilyId}
            data-testid="qr-family-select"
          />
          {familyId === NEW_FAMILY_VALUE ? (
            <Input
              id="qr-new-family-name"
              name="new_family_name"
              label="New Family Name"
              value={newFamilyName}
              onChange={setNewFamilyName}
              placeholder="e.g. The Smith Family"
              data-testid="qr-new-family-name"
            />
          ) : null}
          <Select
            id="qr-role"
            name="invited_role"
            label="Role"
            options={[
              { value: "parent", label: "Parent" },
              { value: "student", label: "Student" },
            ]}
            value={invitedRole}
            onChange={setInvitedRole}
            data-testid="qr-role-select"
          />
          {generateMutation.isError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
            >
              {getErrorMessage(generateMutation.error, "Failed to generate invite")}
            </div>
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!canGenerate || generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
              data-testid="qr-generate"
            >
              {generateMutation.isPending ? "Generating..." : "Generate QR Code"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
