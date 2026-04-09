"use client";

import { useState, useEffect } from "react";

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}
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
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024
  const { organization } = useAuth();
  const isEnterprise = organization?.subscriptionTier === "enterprise";
  const qc = useQueryClient();

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Fetch existing config
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
        idpCertificate: "", // never pre-fill certificate
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
    const orgId = organization?.id;
    const metadataUrl = `${API}/api/auth/saml/metadata?orgId=${orgId}`;
    await navigator.clipboard.writeText(metadataUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const label = (text: string) => (
    <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9CA3AF", marginBottom: 6 }}>
      {text}
    </span>
  );

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid #E5E7EB",
    borderRadius: 6,
    fontSize: "0.875rem",
    background: "#fff",
    color: "#111827",
    outline: "none",
    boxSizing: "border-box",
  };

  const sectionStyle: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #E5E7EB",
    borderRadius: 10,
    padding: "28px 32px",
    marginBottom: 24,
  };

  // ── Locked state for non-enterprise ──────────────────────────────────────
  if (!isEnterprise) {
    return (
      <div style={{ maxWidth: 1320, margin: "0 auto", padding: isMobile ? "24px 16px" : isTablet ? "40px 24px" : "40px 32px", background: "#F9FAFB", minHeight: "100vh" }}>
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7C3AED", marginBottom: 6 }}>
            Security
          </p>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 700, color: "#111827", margin: 0 }}>SSO & SAML</h1>
          <p style={{ color: "#6B7280", fontSize: "0.9rem", marginTop: 6 }}>Configure SAML 2.0 single sign-on for your organization.</p>
        </div>

        <div style={{ ...sectionStyle, textAlign: "center", padding: "60px 40px" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Lock style={{ width: 22, height: 22, color: "#9CA3AF" }} />
          </div>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#111827", marginBottom: 8 }}>Enterprise Feature</h2>
          <p style={{ color: "#6B7280", fontSize: "0.875rem", maxWidth: 420, margin: "0 auto 24px" }}>
            SAML SSO is available on the Enterprise plan. Upgrade to enable single sign-on for your entire team.
          </p>
          <a
            href="/settings/billing?upgrade=enterprise"
            style={{ display: "inline-block", background: "#7C3AED", color: "#fff", padding: "10px 24px", borderRadius: 8, fontSize: "0.875rem", fontWeight: 600, textDecoration: "none" }}
          >
            Upgrade to Enterprise
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: isMobile ? "24px 16px" : isTablet ? "40px 24px" : "40px 32px", background: "#F9FAFB", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <p style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7C3AED", marginBottom: 6 }}>
          Security
        </p>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, color: "#111827", margin: 0 }}>SSO & SAML</h1>
        <p style={{ color: "#6B7280", fontSize: "0.9rem", marginTop: 6 }}>
          Configure SAML 2.0 single sign-on. Your IdP will authenticate users and redirect back to DevControl.
        </p>
      </div>

      {isLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#6B7280", padding: 32 }}>
          <Loader2 style={{ width: 18, height: 18, animation: "spin 1s linear infinite" }} />
          <span style={{ fontSize: "0.875rem" }}>Loading SSO configuration&hellip;</span>
        </div>
      ) : (
        <>
          {/* SP Metadata (read-only) */}
          {config && (
            <div style={sectionStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                <ShieldCheck style={{ width: 18, height: 18, color: "#7C3AED" }} />
                <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#111827", margin: 0 }}>Service Provider Details</h2>
                <span style={{ marginLeft: "auto", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: config.isActive ? "#059669" : "#9CA3AF", background: config.isActive ? "#ECFDF5" : "#F3F4F6", padding: "2px 8px", borderRadius: 4 }}>
                  {config.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "16px 32px" }}>
                <div>
                  {label("SP Entity ID")}
                  <code style={{ display: "block", fontSize: "0.78rem", color: "#374151", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 12px", wordBreak: "break-all" }}>
                    {config.spEntityId}
                  </code>
                </div>
                <div>
                  {label("ACS (Callback) URL")}
                  <code style={{ display: "block", fontSize: "0.78rem", color: "#374151", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 12px", wordBreak: "break-all" }}>
                    {`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/auth/saml/callback?orgId=${organization?.id}`}
                  </code>
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                {label("SP Metadata URL")}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <code style={{ flex: 1, fontSize: "0.78rem", color: "#374151", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 12px", wordBreak: "break-all" }}>
                    {`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/auth/saml/metadata?orgId=${organization?.id}`}
                  </code>
                  <button
                    onClick={handleCopyMetadata}
                    style={{ padding: "8px 12px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: "0.8rem", color: "#374151" }}
                  >
                    {copied ? <Check style={{ width: 14, height: 14, color: "#059669" }} /> : <Copy style={{ width: 14, height: 14 }} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Configuration Form */}
          <div style={sectionStyle}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#111827", marginBottom: 24, marginTop: 0 }}>
              {config ? "Update SAML Configuration" : "Configure SAML IdP"}
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "20px 32px" }}>
              {/* Provider Name */}
              <div>
                {label("Identity Provider")}
                <select
                  value={form.providerName}
                  onChange={(e) => setForm((f) => ({ ...f, providerName: e.target.value }))}
                  style={{ ...inputStyle, background: "#fff" }}
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
                {label("Allowed Email Domains")}
                <input
                  style={inputStyle}
                  placeholder="company.com, subsidiary.com"
                  value={form.allowedDomains}
                  onChange={(e) => setForm((f) => ({ ...f, allowedDomains: e.target.value }))}
                />
                <p style={{ fontSize: "0.72rem", color: "#9CA3AF", marginTop: 4, marginBottom: 0 }}>
                  Comma-separated. Users with these domains will see &quot;Sign in with SSO&quot; on the login page.
                </p>
              </div>

              {/* IdP Entity ID */}
              <div>
                {label("IdP Entity ID")}
                <input
                  style={inputStyle}
                  placeholder="https://your-idp.okta.com/..."
                  value={form.idpEntityId}
                  onChange={(e) => setForm((f) => ({ ...f, idpEntityId: e.target.value }))}
                />
              </div>

              {/* IdP SSO URL */}
              <div>
                {label("IdP SSO URL")}
                <input
                  style={inputStyle}
                  placeholder="https://your-idp.okta.com/app/.../sso/saml"
                  value={form.idpSsoUrl}
                  onChange={(e) => setForm((f) => ({ ...f, idpSsoUrl: e.target.value }))}
                />
              </div>

              {/* Email Attribute */}
              <div>
                {label("Email Attribute")}
                <input
                  style={inputStyle}
                  placeholder="email"
                  value={form.emailAttr}
                  onChange={(e) => setForm((f) => ({ ...f, emailAttr: e.target.value }))}
                />
                <p style={{ fontSize: "0.72rem", color: "#9CA3AF", marginTop: 4, marginBottom: 0 }}>
                  SAML attribute that contains the user&apos;s email address.
                </p>
              </div>

              {/* Name Attribute */}
              <div>
                {label("Display Name Attribute")}
                <input
                  style={inputStyle}
                  placeholder="displayName"
                  value={form.nameAttr}
                  onChange={(e) => setForm((f) => ({ ...f, nameAttr: e.target.value }))}
                />
              </div>
            </div>

            {/* IdP Certificate */}
            <div style={{ marginTop: 20 }}>
              {label("IdP X.509 Certificate")}
              <textarea
                style={{ ...inputStyle, height: 140, resize: "vertical", fontFamily: "monospace", fontSize: "0.78rem" }}
                placeholder={config ? "Leave blank to keep existing certificate" : "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
                value={form.idpCertificate}
                onChange={(e) => setForm((f) => ({ ...f, idpCertificate: e.target.value }))}
              />
              <p style={{ fontSize: "0.72rem", color: "#9CA3AF", marginTop: 4 }}>
                Paste the X.509 certificate from your IdP (with or without headers). Stored encrypted at rest.
              </p>
            </div>

            {/* Enable toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, paddingTop: 20, borderTop: "1px solid #F3F4F6" }}>
              <button
                onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 8 }}
              >
                {form.isActive
                  ? <ToggleRight style={{ width: 28, height: 28, color: "#7C3AED" }} />
                  : <ToggleLeft style={{ width: 28, height: 28, color: "#D1D5DB" }} />
                }
              </button>
              <div>
                <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#111827", margin: 0 }}>
                  {form.isActive ? "SSO Enabled" : "SSO Disabled"}
                </p>
                <p style={{ fontSize: "0.78rem", color: "#9CA3AF", margin: 0 }}>
                  {form.isActive ? "Users can sign in with your IdP." : "Users must sign in with email and password."}
                </p>
              </div>
            </div>

            {/* Errors / success */}
            {saveError && (
              <p style={{ fontSize: "0.85rem", color: "#EF4444", marginTop: 16 }}>{saveError}</p>
            )}
            {saveSuccess && (
              <p style={{ fontSize: "0.85rem", color: "#059669", marginTop: 16 }}>Configuration saved.</p>
            )}

            {/* Actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24 }}>
              <button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, opacity: saveMutation.isPending ? 0.7 : 1 }}
              >
                {saveMutation.isPending && <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />}
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
                  style={{ background: "none", border: "1px solid #E5E7EB", color: "#EF4444", borderRadius: 8, padding: "9px 18px", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Trash2 style={{ width: 14, height: 14 }} />
                  Remove SSO
                </button>
              )}
            </div>
          </div>

          {/* Info callout */}
          <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "20px 24px" }}>
            <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#5B21B6", marginBottom: 8, marginTop: 0 }}>Setup Checklist</h3>
            <ol style={{ margin: 0, paddingLeft: 20, color: "#6D28D9", fontSize: "0.85rem", lineHeight: 1.8 }}>
              <li>Copy the <strong>ACS URL</strong> and <strong>SP Entity ID</strong> above into your IdP&apos;s SAML application settings.</li>
              <li>Download your IdP&apos;s X.509 certificate and paste it into the Certificate field below.</li>
              <li>Map your IdP attributes to <code>email</code> and <code>displayName</code> (or set custom attribute names).</li>
              <li>Add your organization&apos;s email domains to <strong>Allowed Domains</strong>.</li>
              <li>Enable SSO and save. Test by signing in from the login page.</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
