import { Company } from "../db/models/onboarding-auth.model";
import { getCompanyName } from "./base.email";

const YEAR = new Date().getFullYear();

interface LayoutOptions {
  preheader?: string;
  company?:Company;
}

/**
 * Wraps email body content in the shared NK Securities HTML shell.
 * All templates call this — keeps branding consistent and avoids boilerplate.
 */
export function emailLayout(content: string, { preheader, company }: LayoutOptions = {}): string {
  const preheaderHtml = preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}&nbsp;</div>`
    : '';
  const companyName = getCompanyName(company);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>NK Securities</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f4f5; }
    a { color: #e2b94b; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:#f4f4f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

          <!-- ── Header ── -->
          <tr>
            <td style="background:#0a0a0a;padding:24px 40px;">
              <span style="color:#e2b94b;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:4px;text-transform:uppercase;">
                ${companyName}
              </span>
            </td>
          </tr>

          <!-- ── Body ── -->
          <tr>
            <td style="padding:40px;font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;">
              ${content}
            </td>
          </tr>

          <!-- ── Footer ── -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #ebebeb;padding:24px 40px;">
              <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#888;line-height:1.6;">
                &copy; ${YEAR} ${companyName}. All rights reserved.<br />
                This is an automated message — please do not reply directly to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Reusable call-to-action button snippet. */
export function ctaButton(label: string, url: string): string {
  return `<a href="${url}"
     style="display:inline-block;background:#0a0a0a;color:#e2b94b;font-family:Arial,sans-serif;
            font-size:14px;font-weight:700;letter-spacing:1px;text-decoration:none;
            padding:14px 32px;border-radius:4px;margin-top:24px;">
    ${label}
  </a>`;
}

/** Horizontal divider. */
export function divider(): string {
  return `<hr style="border:none;border-top:1px solid #ebebeb;margin:32px 0;" />`;
}
