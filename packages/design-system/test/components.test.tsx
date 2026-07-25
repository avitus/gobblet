import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Badge,
  Banner,
  Button,
  Card,
  Dialog,
  RangeField,
  SelectField,
  Spinner,
  SwitchField,
  TextField,
  VisuallyHidden,
  cx,
} from "../src/index";

describe("cx", () => {
  it("joins the truthy class names and drops everything else", () => {
    expect(cx("a", false, undefined, null, "", "b")).toBe("a b");
  });
});

describe("Button", () => {
  it("defaults to a non-submitting button so a form is never posted by accident", () => {
    render(<Button>Play</Button>);

    expect(screen.getByRole("button", { name: "Play" })).toHaveProperty("type", "button");
  });

  it("submits when asked to", () => {
    render(<Button type="submit">Sign in</Button>);

    expect(screen.getByRole("button", { name: "Sign in" })).toHaveProperty("type", "submit");
  });

  it("disables and announces itself while busy", () => {
    render(<Button busy>Joining</Button>);

    const button = screen.getByRole("button", { name: "Joining" });
    expect(button).toBeDisabled();
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("is not busy when it is merely disabled", () => {
    render(<Button disabled>Wait</Button>);

    expect(screen.getByRole("button", { name: "Wait" }).getAttribute("aria-busy")).toBeNull();
  });

  it("calls back on click and keeps every variant clickable", async () => {
    const onClick = vi.fn();
    render(
      <>
        <Button variant="secondary" onClick={onClick}>
          Secondary
        </Button>
        <Button variant="ghost" size="sm" onClick={onClick}>
          Ghost
        </Button>
        <Button variant="danger" block onClick={onClick}>
          Resign
        </Button>
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Secondary" }));
    await userEvent.click(screen.getByRole("button", { name: "Ghost" }));
    await userEvent.click(screen.getByRole("button", { name: "Resign" }));

    expect(onClick).toHaveBeenCalledTimes(3);
  });
});

describe("Card", () => {
  it("renders only the parts it is given", () => {
    const { container } = render(<Card>body</Card>);

    expect(container.querySelector("header")).toBeNull();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("renders a heading, a description and actions", () => {
    render(
      <Card compact title="Queue" description="Ranked, 5 minutes" actions={<Badge>live</Badge>}>
        content
      </Card>,
    );

    expect(screen.getByRole("heading", { name: "Queue" })).toBeInTheDocument();
    expect(screen.getByText("Ranked, 5 minutes")).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
  });
});

describe("Banner", () => {
  it("announces an error assertively and anything else politely", () => {
    render(
      <>
        <Banner tone="error" title="Rejected">
          not your turn
        </Banner>
        <Banner tone="warning">reconnecting</Banner>
        <Banner tone="success">paired</Banner>
        <Banner>waiting</Banner>
      </>,
    );

    expect(within(screen.getByRole("alert")).getByText("not your turn")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("renders each tone", () => {
    render(
      <>
        <Badge tone="accent">ranked</Badge>
        <Badge tone="ok">online</Badge>
        <Badge tone="warn">low time</Badge>
        <Badge tone="error">suspended</Badge>
      </>,
    );

    expect(screen.getByText("ranked")).toBeInTheDocument();
    expect(screen.getByText("suspended")).toBeInTheDocument();
  });
});

describe("TextField", () => {
  it("associates the label, the hint and the error with the input", () => {
    render(
      <TextField
        label="Email"
        hint="We never show it"
        error="Already registered"
        defaultValue="a@b.co"
      />,
    );

    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy.split(" ")).toHaveLength(2);
    expect(screen.getByText("We never show it").id).toBe(describedBy.split(" ")[0]);
    expect(screen.getByText("Already registered").id).toBe(describedBy.split(" ")[1]);
  });

  it("describes nothing when there is nothing to describe", () => {
    render(<TextField id="username" label="Username" />);

    const input = screen.getByLabelText("Username");
    expect(input.id).toBe("username");
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("accepts typing", async () => {
    render(<TextField label="Username" />);

    await userEvent.type(screen.getByLabelText("Username"), "avitus");

    expect(screen.getByLabelText("Username")).toHaveValue("avitus");
  });
});

describe("SelectField", () => {
  it("renders the options and reports a change", async () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="Time control"
        hint="Both players get the same clock"
        defaultValue="300"
        onChange={onChange}
        options={[
          { value: "180", label: "3 minutes" },
          { value: "300", label: "5 minutes" },
          { value: "600", label: "10 minutes" },
        ]}
      />,
    );

    const select = screen.getByLabelText("Time control");
    expect(select.getAttribute("aria-describedby")).not.toBeNull();
    await userEvent.selectOptions(select, "600");

    expect(select).toHaveValue("600");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("omits the description when there is no hint", () => {
    render(<SelectField label="Mode" options={[{ value: "casual", label: "Casual" }]} />);

    expect(screen.getByLabelText("Mode").getAttribute("aria-describedby")).toBeNull();
  });
});

describe("SwitchField", () => {
  it("reports the new value when toggled", async () => {
    const onCheckedChange = vi.fn();
    render(
      <SwitchField
        label="Reduced motion"
        hint="Replaces movement with fades"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    await userEvent.click(screen.getByRole("switch", { name: "Reduced motion" }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("does not report anything while disabled", async () => {
    const onCheckedChange = vi.fn();
    render(
      <SwitchField label="Sound" checked disabled onCheckedChange={onCheckedChange} />, //
    );

    await userEvent.click(screen.getByRole("switch", { name: "Sound" }));

    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe("RangeField", () => {
  it("shows the formatted value and reports numbers", () => {
    const onValueChange = vi.fn();
    render(
      <RangeField
        label="Master volume"
        value={0.5}
        onValueChange={onValueChange}
        formatValue={(value) => `${String(Math.round(value * 100))}%`}
      />,
    );

    expect(screen.getByText("50%")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Master volume"), { target: { value: "0.55" } });

    expect(onValueChange).toHaveBeenCalledWith(0.55);
  });

  it("falls back to two decimals", () => {
    render(<RangeField label="Game volume" value={0.25} onValueChange={vi.fn()} />);

    expect(screen.getByText("0.25")).toBeInTheDocument();
  });
});

describe("Dialog", () => {
  it("renders nothing while closed", () => {
    render(
      <Dialog open={false} title="Result">
        body
      </Dialog>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes focus, labels itself and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Match over" onClose={onClose} footer={<Button>Rematch</Button>}>
        You won
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Match over" });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Rematch" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape when it must be answered", async () => {
    render(
      <Dialog open title="Confirm" data-testid="confirm">
        answer me
      </Dialog>,
    );

    await userEvent.keyboard("{Escape}");

    expect(screen.getByTestId("confirm")).toBeInTheDocument();
  });

  it("ignores other keys", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" onClose={onClose}>
        answer me
      </Dialog>,
    );

    await userEvent.keyboard("{Enter}");

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Spinner and VisuallyHidden", () => {
  it("exposes the label to assistive technology only", () => {
    render(<Spinner label="Waiting for an opponent" />);

    expect(screen.getByRole("status")).toHaveTextContent("Waiting for an opponent");
  });

  it("renders hidden text", () => {
    render(<VisuallyHidden>light to move</VisuallyHidden>);

    expect(screen.getByText("light to move")).toBeInTheDocument();
  });
});
