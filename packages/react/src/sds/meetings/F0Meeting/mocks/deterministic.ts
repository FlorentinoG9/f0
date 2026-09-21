import { type MockMeetingSeed } from "./mockSeeds"

export type DeterministicOptions = {
  /**
   * `off` (the default) turns every remote camera off, so the room is avatars.
   * `static` keeps the seed's cameras and paints ONE synthetic frame each — a
   * fixed hue and initials per person, nothing that moves.
   */
  cameras?: "off" | "static"
}

/**
 * The seed with everything that moves taken out, for Chromatic.
 *
 * Nothing animates, nobody speaks, nobody wanders in or out, the timer has no
 * start to count from and no story asks for the real camera. What is left
 * renders the same every time, which is what a visual diff needs.
 */
export const deterministic = (
  seed: MockMeetingSeed,
  { cameras = "off" }: DeterministicOptions = {}
): MockMeetingSeed => ({
  ...seed,
  room: { ...seed.room, startedAt: undefined },
  videoSource: "synthetic",
  animateVideo: false,
  audio: false,
  script: undefined,
  churnEveryMs: undefined,
  others: seed.others.map((person) => ({
    ...person,
    camera: cameras === "static" ? person.camera : false,
  })),
})
