import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, X } from 'lucide-react';
import { api } from '../lib/api';

interface TokenRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

/**
 * Personal access tokens for the MCP server. The plaintext is shown exactly
 * once; revocation takes effect on the next request.
 */
export function UserSettings() {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [name, setName] = useState('');
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .listTokens()
      .then(({ tokens: rows }) => setTokens(rows))
      .catch(() => undefined);
  }, [open]);

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const created = await api.createToken(trimmed);
      setFreshToken(created.token);
      setName('');
      const { tokens: rows } = await api.listTokens();
      setTokens(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the token');
    }
  }

  async function revoke(id: string): Promise<void> {
    await api.revokeToken(id).catch(() => undefined);
    const { tokens: rows } = await api.listTokens();
    setTokens(rows);
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Access tokens"
        aria-expanded={open}
        title="Access tokens"
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors duration-120 hover:bg-row-hover hover:text-text-primary"
      >
        <KeyRound size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute bottom-14 left-3 z-40 w-[300px] rounded-lg border border-hairline bg-panel shadow-overlay">
          <header className="flex h-11 items-center justify-between border-b border-hairline px-4">
            <p className="eyebrow">Access tokens</p>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close access tokens"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors duration-120 hover:bg-row-hover hover:text-text-primary"
            >
              <X size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </header>
          <div className="p-4">
            <p className="text-[12px] leading-snug text-text-secondary">
              Tokens let Claude Desktop or Cursor query your team memory, read only, with your exact
              room access.
            </p>
            <form onSubmit={(e) => void create(e)} className="mt-3 flex gap-1.5">
              <label htmlFor="token-name" className="sr-only">
                Token name
              </label>
              <input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Token name"
                maxLength={64}
                className="min-w-0 flex-1 rounded-md border border-hairline bg-ground px-2 py-1.5 text-[13px] text-text-primary placeholder:text-text-secondary focus:border-accent-ink focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-md bg-text-primary px-2.5 py-1.5 text-[12px] font-semibold text-ground transition-opacity duration-120 hover:opacity-90"
              >
                Create token
              </button>
            </form>
            {error && (
              <p role="alert" className="mt-2 text-[12px] text-danger">
                {error}
              </p>
            )}
            {freshToken && (
              <div className="mt-2 rounded-md border border-hairline bg-ground p-2">
                <p className="text-[11px] text-text-secondary">
                  Copy it now; it is shown exactly once.
                </p>
                <code className="block font-mono text-[11px] break-all text-text-primary select-all">
                  {freshToken}
                </code>
              </div>
            )}
            {tokens.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-hairline pt-3">
                {tokens.map((token) => (
                  <li key={token.id} className="flex items-center gap-2 text-[12px]">
                    <span
                      className={`min-w-0 flex-1 truncate ${token.revoked ? 'text-text-secondary line-through' : 'text-text-primary'}`}
                    >
                      {token.name}
                    </span>
                    {token.revoked ? (
                      <span className="font-mono text-[10px] text-text-secondary uppercase">
                        revoked
                      </span>
                    ) : (
                      <button
                        onClick={() => void revoke(token.id)}
                        className="shrink-0 rounded-md border border-hairline px-1.5 py-0.5 text-[11px] text-danger transition-colors duration-120 hover:bg-row-hover"
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
