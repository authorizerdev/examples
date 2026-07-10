// Custom email templates, end to end:
// 1. admin `_add_email_template` overriding the magic-link email
// 2. trigger `magic_link_login`
// 3. read the rendered email from Mailpit — subject and body use the custom
//    template instead of the built-in one
// 4. clean up (delete the template) so the default email comes back
//
// Templates are Go html/template strings. Variables available for
// `magic_link_login` (and the other verification emails):
//   {{.user.email}} {{.user.given_name}} ...   the user object
//   {{.organization.name}} {{.organization.logo}}
//   {{.verification_url}}                       the link to click
// The OTP email (`verification_otp`) gets {{.otp}} instead of the URL.
//
// Valid event_name values: basic_auth_signup, magic_link_login,
// update_email, forgot_password, verification_otp, invite_member.
import {
  gql,
  adminHeaders,
  clearMailbox,
  waitForEmail,
  randomEmail,
} from '../lib/common.mjs';

const email = randomEmail('template');

const subject = 'Your sign-in link for {{.organization.name}}';
const template = `
<h1>Hey {{.user.email}} 👋</h1>
<p>Click below to sign in to {{.organization.name}} — no password needed.</p>
<p><a href="{{.verification_url}}">Sign me in</a></p>
<p style="color:#888">Custom template from the with-auth-recipes example.</p>
`;

// 1. Install the custom template for the magic-link email.
const { data: added } = await gql(
  `mutation ($params: AddEmailTemplateRequest!) {
    _add_email_template(params: $params) { message }
  }`,
  { params: { event_name: 'magic_link_login', subject, template } },
  adminHeaders
);
console.log('_add_email_template:', added._add_email_template.message);

try {
  // 2. Trigger the email.
  await clearMailbox();
  await gql(
    `mutation ($params: MagicLinkLoginRequest!) {
      magic_link_login(params: $params) { message }
    }`,
    { params: { email } }
  );

  // 3. Show the rendered result.
  const message = await waitForEmail(email);
  console.log('\nrendered subject:', JSON.stringify(message.Subject));
  console.log('rendered body:\n', message.HTML.trim());

  if (!message.Subject.includes('Acme Local')) throw new Error('subject not rendered from custom template');
  if (!message.HTML.includes(email)) throw new Error('user variable not rendered');
  if (!message.HTML.includes('verify_email?token=')) throw new Error('verification_url not rendered');
  console.log('\nOK: custom template rendered with user, organization and verification_url.');
} finally {
  // 4. Clean up so recipe 1 keeps using the default email.
  const { data } = await gql(
    `query { _email_templates(params: {}) { email_templates { id event_name } } }`,
    {},
    adminHeaders
  );
  const templates = data._email_templates.email_templates;
  for (const t of templates.filter((t) => t.event_name === 'magic_link_login')) {
    await gql(
      `mutation ($params: DeleteEmailTemplateRequest!) { _delete_email_template(params: $params) { message } }`,
      { params: { id: t.id } },
      adminHeaders
    );
    console.log('cleaned up custom template', t.id);
  }
}
