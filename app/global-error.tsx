"use client";

/**
 * The boundary of last resort: a throw in the root layout, where `error.tsx`
 * cannot reach because the layout it renders inside is the thing that broke.
 *
 * It replaces the whole document, so it brings its own <html> and <body> —
 * and it is styled inline on purpose. Everything the house style needs
 * (globals.css, the theme class next-themes writes, the font stack) is set
 * up by the layout that just failed, so a class name here is a bet on the
 * broken thing having worked. Cream ground and dark ink, hardcoded, is the
 * one screen in the app allowed to ignore the tokens.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#f1edde",
          color: "#23281e",
          fontFamily: "Palatino, Georgia, serif",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: "26rem" }}>
          <div
            style={{
              fontSize: "0.6875rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#5a5f4e",
            }}
          >
            Play suspended
          </div>
          <h1
            style={{
              margin: "0.25rem 0 0",
              fontSize: "1.5rem",
              fontStyle: "italic",
              fontWeight: 600,
            }}
          >
            The clubhouse is dark
          </h1>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem", color: "#5a5f4e" }}>
            Something failed before the page could be laid out. Your card is
            safe — every score lives on the server, not this screen.
          </p>
          {error.digest ? (
            <p
              style={{
                margin: "0.5rem 0 0",
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: "0.625rem",
                color: "#5a5f4e",
              }}
            >
              ref {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              minHeight: "3rem",
              width: "100%",
              maxWidth: "15rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#23281e",
              color: "#f1edde",
              fontFamily: "inherit",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
