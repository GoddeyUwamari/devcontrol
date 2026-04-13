"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/contexts/auth-context";
import { Lock, ShieldCheck, Copy, Check, Trash2, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface SSOConfig {
  id: string;
  providerName: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  spEntityId: string;
  attributeMapping: { email: string; name: string };
  allowedDomains: string[];
  isActive: boolean;
}

interface FormState {
  providerName: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  emailAttr: string;
  nameAttr: string;
  allowedDomains: string;
  isActive: boolean;
}

const DEFAULT_FORM: FormState = {
  providerName: "Okta",
  idpEntityId: "",
  idpSsoUrl: "",
  idpCertificate: "",
  emailAttr: "email",
  nameAttr: "displayName",
  allowedDomains: "",
  isActive: false,
};

function authHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth-token") : null;
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export default function SSOSettingsPage() {
  const { organization } = useAuth();
  const isEnterprise = organization?.subscriptionTier === "enterprise";
  const qc = useQueryClient();

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: config, isLoading } = useQuery<SSOConfig | null>({
    queryKey: ["sso-config"],
    enabled: isEnterprise,
    queryFn: async () => {
      const res = await fetch(`${API}/api/auth/saml/config`, { headers: authHeaders() });
      const json = await res.json();
      return json.data ?? null;
    },
  });

  useEffect(() => {
    if (config) {
      setForm({
        providerName: config.providerName,
        idpEntityId: config.idpEntityId,
        idpSsoUrl: config.idpSsoUrl,
        idpCertificate: "",
        emailAttr: config.attributeMapping?.email ?? "email",
        nameAttr: config.attributeMapping?.name ?? "displayName",
        allowedDomains: (config.allowedDomains ?? []).join(", "),
        isActive: config.isActive,
      });
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      const res = await fetch(`${API}/api/auth/saml/config`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          providerName: payload.providerName,
          idpEntityId: payload.idpEntityId,
          idpSsoUrl: payload.idpSsoUrl,
          idpCertificate: payload.idpCertificate,
          attributeMapping: { email: payload.emailAttr, name: payload.nameAttr },
          allowedDomains: payload.allowedDomains.split(",").map((d) => d.trim()).filter(Boolean),
          isActive: payload.isActive,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Save failed");
      return json.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sso-config"] });
      setSaveError(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: (err: any) => setSaveError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/api/auth/saml/config`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sso-config"] });
      setForm(DEFAULT_FORM);
    },
  });

  const handleCopyMetadata = async () => {
    if (!config?.spEntityId) return;
    const metadataUrl = `${API}/api/auth/saml/metadata?orgId=${organization?.id}`;
    await navigator.clipboard.writeText(metadataUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Locked state for non-enterprise ──────────────────────────────────────
  if (!isEnterprise) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 bg-gray-50 min-h-screen">
        <div className="mb-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700 mb-1.5">Security</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">SSO & SAML</h1>
          <p className="text-gray-500 text-sm mt-1.5">Configure SAML 2.0 single sign-on for your organization.</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl py-16 px-10 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-5 h-5 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Enterprise Feature</h2>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
            SAML SSO is available on the Enterprise plan. Upgrade to enable single sign-on for your entire team.
          </p>
          
           <a href="/settings/billing?upgrade=enterprise" className="inline-block bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline">
  Upgrade to Enterprise
</a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1320px] mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 bg-gray-50 min-h-screen">

      {/* Header */}
      <div className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700 mb-1.5">Security</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">SSO & SAML</h1>
        <p className="text-gray-500 text-sm mt-1.5">
          Configure SAML 2.0 single sign-on. Your IdP will authenticate users and redirect back to DevControl.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2.5 text-gray-500 p-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading SSO configuration…</span>
        </div>
      ) : (
        <>
          {/* SP Metadata */}
          {config && (
            <div className="bg-white border border-gray-200 rounded-xl px-8 py-7 mb-6">
              <div className="flex items-center gap-2 mb-5">
                <ShieldCheck className="w-4 h-4 text-violet-700" />
                <h2 className="text-base font-semibold text-gray-900 m-0">Service Provider Details</h2>
                <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${config.isActive ? 'text-emerald-700 bg-emerald-50' : 'text-gray-400 bg-gray-100'}`}>
                  {config.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-x-8">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">SP Entity ID</span>
                  <code className="block text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 break-all">{config.spEntityId}</code>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">ACS (Callback) URL</span>
                  <code className="block text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 break-all">
                    {`${API}/api/auth/saml/callback?orgId=${organization?.id}`}
                  </code>
                </div>
              </div>
              <div className="mt-4">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">SP Metadata URL</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 break-all">
                    {`${API}/api/auth/saml/metadata?orgId=${organization?.id}`}
                  </code>
                  <button
                    onClick={handleCopyMetadata}
                    className="flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-md bg-white cursor-pointer text-xs text-gray-700 hover:bg-gray-50 transition-colors shrink-0"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Configuration Form */}
          <div className="bg-white border border-gray-200 rounded-xl px-8 py-7 mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-6">
              {config ? "Update SAML Configuration" : "Configure SAML IdP"}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-x-8">
              {/* Provider Name */}
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Identity Provider</span>
                <select
                  value={form.providerName}
                  onChange={(e) => setForm((f) => ({ ...f, providerName: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white text-gray-900 outline-none"
                >
                  <option>Okta</option>
                  <option>Azure AD</option>
                  <option>Google Workspace</option>
                  <option>OneLogin</option>
                  <option>PingIdentity</option>
                  <option>ADFS</option>
                  <option>Custom SAML IdP</option>
                </select>
              </div>

              {/* Allowed Domains */}
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Allowed Email Domains</span>
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white text-gray-900 outline-none"
                  placeholder="company.com, subsidiary.com"
                  value={form.allowedDomains}
                  onChange={(e) => setForm((f) => ({ ...f, allowedDomains: e.target.value }))}
                />
                <p className="text-[11px] text-gray-400 mt-1">Comma-separated. Users with these domains will see &quot;Sign in with SSO&quot; on the login page.</p>
              </div>

              {/* IdP Entity ID */}
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">IdP Entity ID</span>
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white text-gray-900 outline-none"
                  placeholder="https://your-idp.okta.com/..."
                  value={form.idpEntityId}
                  onChange={(e) => setForm((f) => ({ ...f, idpEntityId: e.target.value }))}
                />
              </div>

              {/* IdP SSO URL */}
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">IdP SSO URL</span>
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white text-gray-900 outline-none"
                  placeholder="https://your-idp.okta.com/app/.../sso/saml"
                  value={form.idpSsoUrl}
                  onChange={(e) => setForm((f) => ({ ...f, idpSsoUrl: e.target.value }))}
                />
              </div>

              {/* Email Attribute */}
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Email Attribute</span>
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white text-gray-900 outline-none"
                  placeholder="email"
                  value={form.emailAttr}
                  onChange={(e) => setForm((f) => ({ ...f, emailAttr: e.target.value }))}
                />
                <p className="text-[11px] text-gray-400 mt-1">SAML attribute that contains the user&apos;s email address.</p>
              </div>

              {/* Name Attribute */}
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Display Name Attribute</span>
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white text-gray-900 outline-none"
                  placeholder="displayName"
                  value={form.nameAttr}
                  onChange={(e) => setForm((f) => ({ ...f, nameAttr: e.target.value }))}
                />
              </div>
            </div>

            {/* IdP Certificate */}
            <div className="mt-5">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">IdP X.509 Certificate</span>
              <textarea
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-xs font-mono bg-white text-gray-900 outline-none resize-y"
                rows={6}
                placeholder={config ? "Leave blank to keep existing certificate" : "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
                value={form.idpCertificate}
                onChange={(e) => setForm((f) => ({ ...f, idpCertificate: e.target.value }))}
              />
              <p className="text-[11px] text-gray-400 mt-1">Paste the X.509 certificate from your IdP (with or without headers). Stored encrypted at rest.</p>
            </div>

            {/* Enable toggle */}
            <div className="flex items-center gap-3 mt-5 pt-5 border-t border-gray-100">
              <button
                onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                className="bg-transparent border-none cursor-pointer p-0 flex items-center gap-2"
              >
                {form.isActive
                  ? <ToggleRight className="w-7 h-7 text-violet-700" />
                  : <ToggleLeft className="w-7 h-7 text-gray-300" />}
              </button>
              <div>
                <p className="text-sm font-semibold text-gray-900 m-0">{form.isActive ? "SSO Enabled" : "SSO Disabled"}</p>
                <p className="text-xs text-gray-400 m-0">{form.isActive ? "Users can sign in with your IdP." : "Users must sign in with email and password."}</p>
              </div>
            </div>

            {saveError && <p className="text-sm text-red-500 mt-4">{saveError}</p>}
            {saveSuccess && <p className="text-sm text-emerald-600 mt-4">Configuration saved.</p>}

            {/* Actions */}
            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                className="flex items-center gap-1.5 bg-violet-700 text-white border-none rounded-lg px-5 py-2.5 text-sm font-semibold cursor-pointer disabled:opacity-70"
              >
                {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {config ? "Update Configuration" : "Save Configuration"}
              </button>

              {config && (
                <button
                  onClick={() => {
                    if (confirm("Delete SSO configuration? Users will no longer be able to sign in with SSO.")) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="flex items-center gap-1.5 bg-transparent border border-gray-200 text-red-500 rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove SSO
                </button>
              )}
            </div>
          </div>

          {/* Setup Checklist */}
          <div className="bg-violet-50 border border-violet-200 rounded-xl px-6 py-5">
            <h3 className="text-sm font-semibold text-violet-800 mb-2">Setup Checklist</h3>
            <ol className="m-0 pl-5 text-violet-700 text-sm leading-relaxed space-y-1">
              <li>Copy the <strong>ACS URL</strong> and <strong>SP Entity ID</strong> above into your IdP&apos;s SAML application settings.</li>
              <li>Download your IdP&apos;s X.509 certificate and paste it into the Certificate field below.</li>
              <li>Map your IdP attributes to <code className="text-xs bg-violet-100 px-1 py-0.5 rounded">email</code> and <code className="text-xs bg-violet-100 px-1 py-0.5 rounded">displayName</code> (or set custom attribute names).</li>
              <li>Add your organization&apos;s email domains to <strong>Allowed Domains</strong>.</li>
              <li>Enable SSO and save. Test by signing in from the login page.</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}