import { Badge, Button, Card, cx, useMediaQuery } from "@gobblet/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useApi } from "../api/provider";
import { useSessionStore } from "../session/store";
import styles from "./AppShell.module.css";

const NARROW_QUERY = "(max-width: 767px)";

type NavigationItem = Readonly<{ to: string; label: string }>;

const NAVIGATION: readonly NavigationItem[] = [
  { to: "/", label: "Play" },
  { to: "/history", label: "History" },
  { to: "/settings", label: "Settings" },
];

export function AppShell(): React.JSX.Element {
  const tooNarrow = useMediaQuery(NARROW_QUERY);
  const session = useSessionStore((state) => state.session);
  const signedOut = useSessionStore((state) => state.signedOut);
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (tooNarrow) {
    return (
      <div className={styles.tooNarrow}>
        <Card title="A larger window is needed">
          Gobblet Online is a desktop game: the board needs at least 768 pixels of width. Widen the
          window or use a larger display.
        </Card>
      </div>
    );
  }

  const onSignOut = (): void => {
    void api.signOut().finally(() => {
      signedOut();
      queryClient.clear();
      void navigate("/");
    });
  };

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <NavLink className={cx(styles.brand)} to="/">
          Gobblet
        </NavLink>
        <nav className={styles.nav} aria-label="Main">
          {NAVIGATION.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => cx(styles.navLink, isActive && styles.navLinkActive)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.identity}>
          {session === null ? (
            <>
              <NavLink to="/sign-in">Sign in</NavLink>
              <NavLink to="/register">Create account</NavLink>
            </>
          ) : (
            <>
              <span className={styles.identityName} data-testid="identity-name">
                {session.displayName}
              </span>
              {session.kind === "guest" && <Badge>guest</Badge>}
              <Button size="sm" variant="ghost" onClick={onSignOut}>
                Sign out
              </Button>
            </>
          )}
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
