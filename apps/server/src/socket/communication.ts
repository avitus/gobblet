import type { MuteState } from "@gobblet/protocol";

/**
 * The two channels of spec section 12, muted independently. Sound is not one of
 * them: a sound is never sent, so muting it stays entirely inside the client
 * (docs/adr/0026-communication-is-relayed-never-stored.md).
 */
export type CommunicationChannel = "preset-messages" | "reactions";

/**
 * Which connections have withheld which channel, for as long as the connection
 * lasts. Absence is the default, so a connection that has said nothing hears
 * everything and mute is enforced by not sending rather than by asking the
 * recipient to hide it (appendix P6.2).
 */
export class ChannelMutes<TConnection extends object> {
  private readonly presetMessages = new WeakSet<TConnection>();

  private readonly reactions = new WeakSet<TConnection>();

  set(connection: TConnection, state: MuteState): void {
    record(this.presetMessages, connection, state.presetMessagesMuted);
    record(this.reactions, connection, state.reactionsMuted);
  }

  withholds(connection: TConnection, channel: CommunicationChannel): boolean {
    return (channel === "preset-messages" ? this.presetMessages : this.reactions).has(connection);
  }
}

function record<TConnection extends object>(
  muted: WeakSet<TConnection>,
  connection: TConnection,
  isMuted: boolean,
): void {
  if (isMuted) {
    muted.add(connection);
  } else {
    muted.delete(connection);
  }
}
