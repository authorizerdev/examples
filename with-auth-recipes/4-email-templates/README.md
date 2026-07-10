# Custom email templates

Override the built-in email for any verification event — here, the
magic-link email — and see the rendered result in Mailpit.

**Ops used**: `_add_email_template`, `_email_templates`,
`_delete_email_template` (admin) + `magic_link_login` to trigger the email.

## Template model

Templates (subject **and** body) are Go `html/template` strings, rendered
with:

| Variable | Meaning |
| --- | --- |
| `{{.user.email}}`, `{{.user.given_name}}`, ... | the recipient user object |
| `{{.organization.name}}`, `{{.organization.logo}}` | from `--organization-name` / `--organization-logo` |
| `{{.verification_url}}` | the link to click (all verification emails) |
| `{{.otp}}` | the code (only for `verification_otp`) |

Valid `event_name` values: `basic_auth_signup`, `magic_link_login`,
`update_email`, `forgot_password`, `verification_otp`, `invite_member`.
One template per event; when none is registered the built-in default is used.
(The optional `design` field stores the dashboard's visual-editor state —
leave it out when supplying raw HTML.)

## Run

```sh
node email-template.mjs
```

The script installs a custom template, triggers a magic-link email, prints
the rendered subject/body fetched from Mailpit, asserts the variables were
substituted, then deletes the template so the default returns.
