import { Banner, Button, Card, TextField } from "@gobblet/design-system";
import { emailSchema, passwordSchema, usernameSchema } from "@gobblet/protocol";
import type { AuthResponse, ClaimGuestResponse } from "@gobblet/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { describeApiError } from "../api/errors";
import { useApi } from "../api/provider";
import { storedSessionFromAccount } from "../session/apply-auth";
import { useSessionStore } from "../session/store";
import styles from "./AuthScreens.module.css";

type Credentials = Readonly<{ email: string; password: string; username: string }>;

type FieldErrors = Readonly<{ email?: string; password?: string; username?: string }>;

function validate(
  values: Credentials,
): { ok: true; value: Credentials } | { ok: false; errors: FieldErrors } {
  const email = emailSchema.safeParse(values.email);
  const password = passwordSchema.safeParse(values.password);
  const username = usernameSchema.safeParse(values.username);

  if (email.success && password.success && username.success) {
    return {
      ok: true,
      value: { email: email.data, password: password.data, username: username.data },
    };
  }

  return {
    ok: false,
    errors: {
      ...(email.success ? {} : { email: "Enter a valid email address." }),
      ...(password.success
        ? {}
        : { password: "At least 12 characters, with a letter and a number or symbol." }),
      ...(username.success
        ? {}
        : { username: "3 to 20 characters: start with a letter, then letters, digits or _." }),
    },
  };
}

export function RegisterScreen(): React.JSX.Element {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionStore((state) => state.session);
  const signedIn = useSessionStore((state) => state.signedIn);
  const claiming = session?.kind === "guest";

  const [values, setValues] = useState<Credentials>({ email: "", password: "", username: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [usernameNotice, setUsernameNotice] = useState<string | null>(null);

  const onCreated = (response: AuthResponse | ClaimGuestResponse): void => {
    signedIn(storedSessionFromAccount(response.account, response.session));
    queryClient.clear();
    void navigate("/verify-email", {
      state: { token: response.emailVerification?.token ?? null },
    });
  };

  const createAccount = useMutation({
    mutationFn: (input: Credentials) => (claiming ? api.claimGuest(input) : api.register(input)),
    onSuccess: onCreated,
  });

  const checkUsername = useMutation({
    mutationFn: (username: string) => api.checkUsername(username),
    onSuccess: (result) => {
      setUsernameNotice(
        result.available ? null : `That username is unavailable (${result.reason ?? "taken"}).`,
      );
    },
  });

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const checked = validate(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    createAccount.mutate(checked.value);
  };

  return (
    <Card
      className={styles.narrow}
      title={claiming ? "Keep your guest history" : "Create an account"}
      description={
        claiming
          ? "Your guest matches move to the new account, and the guest session becomes it."
          : "An account is needed for ranked play, a rating and a permanent history."
      }
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {createAccount.isError && (
          <Banner tone="error">{describeApiError(createAccount.error)}</Banner>
        )}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={values.email}
          error={errors.email}
          onChange={(event) => {
            setValues((current) => ({ ...current, email: event.target.value }));
          }}
        />
        <TextField
          label="Username"
          autoComplete="username"
          value={values.username}
          error={errors.username}
          hint={usernameNotice ?? "Public and permanent. Letters, digits and underscore."}
          onChange={(event) => {
            setUsernameNotice(null);
            setValues((current) => ({ ...current, username: event.target.value }));
          }}
          onBlur={() => {
            if (values.username !== "") {
              checkUsername.mutate(values.username);
            }
          }}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          value={values.password}
          error={errors.password}
          onChange={(event) => {
            setValues((current) => ({ ...current, password: event.target.value }));
          }}
        />
        <Button type="submit" busy={createAccount.isPending} data-testid="register-submit">
          {claiming ? "Claim this session" : "Create account"}
        </Button>
        <p className={styles.footer}>
          <span>Already registered?</span>
          <Link to="/sign-in">Sign in</Link>
        </p>
      </form>
    </Card>
  );
}
