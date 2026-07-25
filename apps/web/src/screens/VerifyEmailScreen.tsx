import { Banner, Button, Card, TextField } from "@gobblet/design-system";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { describeApiError } from "../api/errors";
import { useApi } from "../api/provider";
import { queryKeys } from "../api/queries";
import styles from "./AuthScreens.module.css";

function handoffToken(state: unknown): string | null {
  if (typeof state !== "object" || state === null) {
    return null;
  }
  const candidate = (state as Record<string, unknown>).token;
  return typeof candidate === "string" ? candidate : null;
}

/**
 * There is no mail sender yet (appendix P3), so the token is handed to the
 * client in the registration response outside production and pasted here.
 */
export function VerifyEmailScreen(): React.JSX.Element {
  const api = useApi();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const handoff = handoffToken(location.state);
  const [token, setToken] = useState(handoff ?? "");

  const verify = useMutation({
    mutationFn: (value: string) => api.verifyEmail(value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void navigate("/");
    },
  });

  return (
    <Card
      className={styles.narrow}
      title="Verify your email"
      description="Ranked play needs a verified address. Paste the verification token below."
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim() !== "") {
            verify.mutate(token.trim());
          }
        }}
        noValidate
      >
        {verify.isError && <Banner tone="error">{describeApiError(verify.error)}</Banner>}
        {handoff !== null && (
          <Banner tone="info" title="Development handoff">
            No mail is sent outside production, so the token came back with your registration:
            <span className={styles.token}>{handoff}</span>
          </Banner>
        )}
        <TextField
          label="Verification token"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
          }}
        />
        <Button type="submit" busy={verify.isPending} data-testid="verify-submit">
          Verify
        </Button>
      </form>
    </Card>
  );
}
