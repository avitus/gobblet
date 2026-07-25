import { Banner, Button, Card, TextField } from "@gobblet/design-system";
import { emailSchema, passwordSchema } from "@gobblet/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { describeApiError } from "../api/errors";
import { useApi } from "../api/provider";
import { storedSessionFromAccount } from "../session/apply-auth";
import { useSessionStore } from "../session/store";
import styles from "./AuthScreens.module.css";

export function SignInScreen(): React.JSX.Element {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signedIn = useSessionStore((state) => state.signedIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const signIn = useMutation({
    mutationFn: (input: { email: string; password: string }) => api.signIn(input),
    onSuccess: (response) => {
      signedIn(storedSessionFromAccount(response.account, response.session));
      queryClient.clear();
      void navigate("/");
    },
  });

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsedEmail = emailSchema.safeParse(email);
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedEmail.success || !parsedPassword.success) {
      setFieldError("Enter the email address and password you registered with.");
      return;
    }
    setFieldError(null);
    signIn.mutate({ email: parsedEmail.data, password: parsedPassword.data });
  };

  return (
    <Card className={styles.narrow} title="Sign in">
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {fieldError !== null && <Banner tone="warning">{fieldError}</Banner>}
        {signIn.isError && <Banner tone="error">{describeApiError(signIn.error)}</Banner>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <Button type="submit" busy={signIn.isPending} data-testid="sign-in-submit">
          Sign in
        </Button>
        <p className={styles.footer}>
          <span>No account yet?</span>
          <Link to="/register">Create one</Link>
        </p>
      </form>
    </Card>
  );
}
