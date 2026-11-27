export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const firstLine = (text) => text.split("\n")[0];

/** What was thrown, in its own words. */
export const errorText = (thrown) => (thrown instanceof Error ? thrown.message : String(thrown));

/** The last line of what a program wrote to stderr: where it says what went wrong. */
export const lastLine = (text) => text.trim().split("\n").at(-1);

/** Several lines as one: GitHub's reasons for refusing something come one to a line. */
export const oneLine = (text) => text.split("\n").map((part) => part.trim()).filter((part) => part !== "").join(" ");
