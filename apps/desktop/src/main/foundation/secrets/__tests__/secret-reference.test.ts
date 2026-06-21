/**
 * secret-reference unit tests — the PURE chezmoi `.tmpl` Secret-reference shape (issue 2-05).
 *
 * The security-relevant invariant under test: converting a flagged value into a Secret reference
 * produces ONLY a chezmoi template call that resolves the secret from the user's password manager
 * at Apply time — the raw secret value is NEVER part of the rendered template (it stays in the
 * vault). These tests pin the exact `.tmpl` shape per manager (the issue's acceptance criterion 6)
 * and the source-filename encoding (`dot_…` + `.tmpl`) so chezmoi treats the File as a template.
 */
import { describe, expect, it } from 'vitest'
import {
  isSecretReferenceResolutionFailure,
  PASSWORD_MANAGERS,
  renderSecretReferenceTemplate,
  sourceTemplateName,
  type SecretReferenceRequest,
} from '../secret-reference.js'

describe('renderSecretReferenceTemplate — 1Password (op)', () => {
  it('renders {{ onepasswordRead "op://vault/item/field" }} for the default account', () => {
    const out = renderSecretReferenceTemplate({
      manager: 'op',
      reference: 'op://vault/item/field',
    })
    expect(out).toBe('{{ onepasswordRead "op://vault/item/field" }}')
  })

  it('adds the account arg when the user picked a non-default 1Password account', () => {
    const out = renderSecretReferenceTemplate({
      manager: 'op',
      reference: 'op://Private/GitHub/token',
      account: 'my.1password.com',
    })
    expect(out).toBe('{{ onepasswordRead "op://Private/GitHub/token" "my.1password.com" }}')
  })

  it('never emits the account arg for an empty/whitespace account string', () => {
    const out = renderSecretReferenceTemplate({
      manager: 'op',
      reference: 'op://vault/item/field',
      account: '   ',
    })
    expect(out).toBe('{{ onepasswordRead "op://vault/item/field" }}')
  })
})

describe('renderSecretReferenceTemplate — Bitwarden (bw) and pass', () => {
  it('renders a bitwardenFields field call for Bitwarden', () => {
    const out = renderSecretReferenceTemplate({
      manager: 'bw',
      reference: 'GitHub',
      field: 'token',
    })
    expect(out).toBe('{{ (bitwardenFields "item" "GitHub").token.value }}')
  })

  it('defaults the Bitwarden field to `password` when none is given', () => {
    const out = renderSecretReferenceTemplate({ manager: 'bw', reference: 'GitHub' })
    expect(out).toBe('{{ (bitwardenFields "item" "GitHub").password.value }}')
  })

  it('renders a pass call for the pass store', () => {
    const out = renderSecretReferenceTemplate({ manager: 'pass', reference: 'github/token' })
    expect(out).toBe('{{ pass "github/token" }}')
  })
})

describe('renderSecretReferenceTemplate — security invariant', () => {
  it('NEVER contains the raw secret value (only the vault reference does)', () => {
    const rawSecret = 'AKIAIOSFODNN7EXAMPLE'
    const out = renderSecretReferenceTemplate({
      manager: 'op',
      reference: 'op://vault/aws/access-key-id',
    })
    // The raw secret is not representable in the request at all — but assert it for the record:
    // the rendered template is a reference, never the value.
    expect(out).not.toContain(rawSecret)
  })

  it('escapes a reference that contains a double-quote so the template stays well-formed', () => {
    // Defense-in-depth: a `"` in a reference must not break out of the Go-template string arg.
    const out = renderSecretReferenceTemplate({
      manager: 'op',
      reference: 'op://va"ult/item/field',
    })
    expect(out).toBe('{{ onepasswordRead "op://va\\"ult/item/field" }}')
  })

  it('rejects an empty reference rather than emitting an unresolvable template', () => {
    expect(() =>
      renderSecretReferenceTemplate({ manager: 'op', reference: '   ' } as SecretReferenceRequest),
    ).toThrow(/reference/i)
  })
})

describe('sourceTemplateName — chezmoi source filename encoding', () => {
  it('encodes a dotfile and adds the .tmpl suffix so chezmoi treats it as a template', () => {
    expect(sourceTemplateName('.aws/credentials')).toBe('dot_aws/credentials.tmpl')
  })

  it('leaves a non-dot leading segment unprefixed but still adds .tmpl', () => {
    expect(sourceTemplateName('config/app.conf')).toBe('config/app.conf.tmpl')
  })

  it('does not double-suffix a path that already ends in .tmpl', () => {
    expect(sourceTemplateName('.zshrc.tmpl')).toBe('dot_zshrc.tmpl')
  })
})

describe('isSecretReferenceResolutionFailure — provider-agnostic apply-error detection', () => {
  it('detects a 1Password not-signed-in / locked failure', () => {
    expect(
      isSecretReferenceResolutionFailure(
        'chezmoi: template: dot_aws/credentials.tmpl: onepasswordRead: op read: ' +
          '[ERROR] you are not currently signed in. Please run `op signin`',
      ),
    ).toBe(true)
  })

  it('detects a missing-item / missing-field failure', () => {
    expect(
      isSecretReferenceResolutionFailure(
        'template: dot_x.tmpl:1: onepasswordRead "op://vault/item/field": ' +
          "isn't an item. Specify the item with its UUID, name, or domain.",
      ),
    ).toBe(true)
  })

  it('detects a Bitwarden locked-vault failure', () => {
    expect(
      isSecretReferenceResolutionFailure(
        'bitwardenFields: bw: You are not logged in. Vault is locked.',
      ),
    ).toBe(true)
  })

  it('detects a pass entry-not-found failure', () => {
    expect(
      isSecretReferenceResolutionFailure(
        'template: dot_x.tmpl:1:3: pass: github/token is not in the password store.',
      ),
    ).toBe(true)
  })

  it('does NOT flag an unrelated chezmoi apply error (a real non-secret failure)', () => {
    expect(
      isSecretReferenceResolutionFailure('chezmoi: permission denied writing .gitconfig'),
    ).toBe(false)
  })
})

describe('PASSWORD_MANAGERS — the v1 catalog', () => {
  it('lists exactly op, bw, and pass with their CLI + install hints', () => {
    expect(PASSWORD_MANAGERS.map((m) => m.id)).toEqual(['op', 'bw', 'pass'])
    for (const manager of PASSWORD_MANAGERS) {
      expect(manager.cli.length).toBeGreaterThan(0)
      expect(manager.installHint.length).toBeGreaterThan(0)
      expect(manager.label.length).toBeGreaterThan(0)
    }
  })
})
