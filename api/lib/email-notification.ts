const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

interface AccessRequestEmailParams {
  requesterEmail: string;
  requesterName: string | null;
  message: string | null;
  approveUrl: string;
}

export async function sendAccessRequestEmail(params: AccessRequestEmailParams): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn('[Email] RESEND_API_KEY not set, skipping email notification');
    return false;
  }

  if (!ADMIN_EMAIL) {
    console.warn('[Email] ADMIN_EMAIL not set, skipping email notification');
    return false;
  }

  const { requesterEmail, requesterName, message, approveUrl } = params;
  const displayName = requesterName || requesterEmail;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a2e;">New Access Request</h2>
      <p><strong>${displayName}</strong> (${requesterEmail}) is requesting access to Magic Bracket Simulator.</p>
      ${message ? `<p style="background: #f5f5f5; padding: 12px; border-radius: 6px; border-left: 3px solid #6366f1;"><em>"${message}"</em></p>` : ''}
      <p>
        <a href="${approveUrl}" style="display: inline-block; background: #22c55e; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          Approve Access
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">This link expires in 24 hours.</p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Magic Bracket Simulator <onboarding@resend.dev>',
        to: [ADMIN_EMAIL],
        subject: `Access Request: ${displayName}`,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[Email] Resend API error:', response.status, body);
      return false;
    }

    console.log(`[Email] Access request notification sent for ${requesterEmail}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send notification:', error);
    return false;
  }
}
