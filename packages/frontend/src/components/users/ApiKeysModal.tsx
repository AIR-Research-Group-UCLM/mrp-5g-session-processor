import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Copy, KeyRound, Plus } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "@/hooks/useApiKeys";
import { formatDate, formatRelativeDate } from "@/utils/format";
import type { ApiKey, UserListItem } from "@mrp/shared";

const EXPIRY_OPTIONS = [null, 30, 90, 365] as const;

type ApiKeyStatus = "active" | "revoked" | "expired";

function getStatus(apiKey: ApiKey): ApiKeyStatus {
  if (apiKey.revokedAt) return "revoked";
  if (apiKey.expiresAt && new Date(apiKey.expiresAt) <= new Date()) return "expired";
  return "active";
}

const STATUS_VARIANTS = {
  active: "success",
  revoked: "error",
  expired: "warning",
} as const;

interface ApiKeysModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserListItem | null;
}

export function ApiKeysModal({ isOpen, onClose, user }: ApiKeysModalProps) {
  const { t } = useTranslation();
  const userId = isOpen ? user?.id ?? null : null;
  const { data: apiKeys, isLoading } = useApiKeys(userId);
  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();

  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setExpiresInDays(null);
      setNameError(undefined);
      setCreatedKey(null);
      setCopied(false);
      setRevokeConfirmId(null);
    }
  }, [isOpen, user]);

  if (!user) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t("apiKeys.nameRequired"));
      return;
    }
    setNameError(undefined);

    const result = await createApiKey.mutateAsync({
      userId: user.id,
      input: { name: name.trim(), expiresInDays },
    });
    setCreatedKey(result.key);
    setCopied(false);
    setName("");
    setExpiresInDays(null);
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    toast.success(t("apiKeys.copied"));
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (keyId: string) => {
    await revokeApiKey.mutateAsync({ userId: user.id, keyId });
    setRevokeConfirmId(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("apiKeys.title", { name: user.name })}
      className="max-w-4xl"
    >
      <div className="space-y-6">
        <p className="text-sm text-gray-600">{t("apiKeys.description")}</p>

        {createdKey && (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("apiKeys.copyWarning")}</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded border border-amber-200 bg-white px-3 py-2 font-mono text-sm text-gray-900">
                {createdKey}
              </code>
              <Button size="sm" variant="secondary" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {t("apiKeys.copy")}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setCreatedKey(null)}>
                {t("apiKeys.done")}
              </Button>
            </div>
          </div>
        )}

        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Input
              id="api-key-name"
              label={t("apiKeys.name")}
              placeholder={t("apiKeys.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={nameError}
              maxLength={100}
              disabled={createApiKey.isPending}
            />
          </div>
          <div className="sm:w-48">
            <label
              htmlFor="api-key-expiry"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              {t("apiKeys.expiry")}
            </label>
            <select
              id="api-key-expiry"
              value={expiresInDays ?? ""}
              onChange={(e) =>
                setExpiresInDays(e.target.value ? Number(e.target.value) : null)
              }
              disabled={createApiKey.isPending}
              className="input"
            >
              {EXPIRY_OPTIONS.map((days) => (
                <option key={days ?? "never"} value={days ?? ""}>
                  {days ? t("apiKeys.expiryDays", { count: days }) : t("apiKeys.noExpiry")}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" isLoading={createApiKey.isPending}>
            <Plus className="h-4 w-4" />
            {t("apiKeys.create")}
          </Button>
        </form>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !apiKeys || apiKeys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-sm text-gray-500">
            <KeyRound className="h-8 w-8 text-gray-300" />
            {t("apiKeys.empty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-500">
                    {t("apiKeys.name")}
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-500">
                    {t("apiKeys.key")}
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-500">
                    {t("apiKeys.status")}
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-500">
                    {t("apiKeys.createdAt")}
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-500">
                    {t("apiKeys.lastUsed")}
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-gray-500">
                    {t("apiKeys.expiresAt")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {apiKeys.map((apiKey) => {
                  const status = getStatus(apiKey);
                  return (
                    <tr key={apiKey.id}>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-900">
                        {apiKey.name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-600">
                        {apiKey.keyPrefix}…
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <Badge variant={STATUS_VARIANTS[status]}>
                          {t(`apiKeys.statuses.${status}`)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600">
                        {formatDate(apiKey.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600">
                        {apiKey.lastUsedAt
                          ? formatRelativeDate(apiKey.lastUsedAt)
                          : t("apiKeys.neverUsed")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600">
                        {apiKey.expiresAt ? formatDate(apiKey.expiresAt) : t("apiKeys.noExpiry")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        {status === "active" &&
                          (revokeConfirmId === apiKey.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => handleRevoke(apiKey.id)}
                                isLoading={revokeApiKey.isPending}
                              >
                                {t("common.confirm")}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setRevokeConfirmId(null)}
                              >
                                {t("common.cancel")}
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setRevokeConfirmId(apiKey.id)}
                            >
                              {t("apiKeys.revoke")}
                            </Button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end border-t pt-4">
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
