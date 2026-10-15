// Sign in with Microsoft (Entra ID): who the person is, and whether their email
// can be trusted to link an existing account.
//
// - Identity is "<tid>:<oid>" (tenant + object id), which is stable; the OIDC
//   "sub" differs per app registration.
// - In a multi-tenant app ("common" / "organizations"), the email claim is not
//   verified by Microsoft: an admin of any tenant can put someone else's address
//   on a user ("nOAuth"). Such an email is only trusted when the "xms_edov"
//   claim says the domain owner verified it, or when the app is restricted to a
//   single tenant (the issuer names a tenant id), where emails are managed by
//   that organization's admins.

export interface MicrosoftClaims {
  tid?: unknown;
  oid?: unknown;
  email?: unknown;
  preferred_username?: unknown;
  name?: unknown;
  xms_edov?: unknown;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when the issuer names one tenant (not common / organizations / consumers). */
export function singleTenantIssuer(issuer: string | undefined): boolean {
  const tenant = issuer?.match(/microsoftonline\.com\/([^/]+)\/v2\.0/i)?.[1];
  return !!tenant && GUID.test(tenant);
}

export function readMicrosoftIdentity(claims: MicrosoftClaims | null | undefined, singleTenant: boolean) {
  const c = claims ?? {};
  const tid = typeof c.tid === "string" && GUID.test(c.tid) ? c.tid.toLowerCase() : null;
  const oid = typeof c.oid === "string" && GUID.test(c.oid) ? c.oid.toLowerCase() : null;
  if (!tid || !oid) return null;
  const emailClaim = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  // The sign-in name (UPN) is admin-managed, so it is only a fallback inside a single tenant.
  const upn = singleTenant && typeof c.preferred_username === "string" ? c.preferred_username.trim().toLowerCase() : "";
  const email = EMAIL.test(emailClaim) ? emailClaim : EMAIL.test(upn) ? upn : "";
  const edov = c.xms_edov === true || c.xms_edov === "true" || c.xms_edov === 1 || c.xms_edov === "1";
  return {
    key: `${tid}:${oid}`,
    email,
    name: typeof c.name === "string" ? c.name.trim().slice(0, 120) : "",
    emailTrusted: !!email && (singleTenant || edov),
  };
}
