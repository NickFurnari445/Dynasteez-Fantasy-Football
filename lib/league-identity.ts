import type { Roster, User } from "./sleeper-types";

// Confirmed Sleeper IDs keep the mapping stable when usernames change.
const managers = [
  ["1180998712864174080", "antbennett10", "Anthony Bennett"],
  ["739566917194530816", "bdempseyNH", "Blake Dempsey"],
  ["1395847710942171136", "Bobthebuilderdoes69", "Jack O'Neill"],
  ["1395281392471912448", "JackBruni", "Jack Bruni"],
  ["1395209345670606848", "JakeFink36", "Jake Fink"],
  ["1131650651114577920", "jcardinal1", "John Cardinal"],
  ["1395505240421187584", "Joshydee", "Josh Denison"],
  ["1257874868087566336", "LTypeL2", "Nico Depalle"],
  ["1123072399274065920", "LukeLynn", "Luke Lynn"],
  ["739563947254013952", "NickFurnari15", "Nick Furnari"],
];
const byId = new Map(managers.map(row => [row[0], row]));
const byUsername = new Map(managers.map(row => [row[1].toLowerCase(), row]));

export function managerIdentity(user: User | undefined, id = user?.user_id) {
  const reported = user?.display_name?.trim() || null;
  const username = user?.username?.trim() || reported;
  const alias = username ? byUsername.get(username.toLowerCase()) : undefined;
  // A known alias on a different stable ID does not establish ownership.
  const known = (id && byId.get(id)) || (alias && (!id || alias[0] === id) ? alias : undefined);
  return { name: known ? known[2] : reported || username, username: username || (known ? known[1] : null) };
}

function avatarUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim() || /avatar_default/i.test(value)) return null;
  if (/^[a-f0-9]{32}$/i.test(value)) return `https://sleepercdn.com/avatars/thumbs/${value}`;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

type TeamIdentity = { roster: Roster; user?: User };

export function identityAvatars(identities: TeamIdentity[]) {
  const logos = identities.flatMap(({ roster, user }) => [
    roster.metadata?.team_avatar, roster.metadata?.avatar, user?.metadata?.team_avatar, user?.metadata?.avatar,
  ]);
  return [...new Set([...logos, ...identities.map(({ user }) => user?.avatar)]
    .map(avatarUrl).filter((url): url is string => url !== null))];
}

export function teamAvatars(roster: Roster, user?: User) {
  return identityAvatars([{ roster, user }]);
}
