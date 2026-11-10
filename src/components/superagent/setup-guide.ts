/**
 * The setup guide's content (decision 155; docs/contracts/ui.md "Superagent control", "Setup guide"):
 * the steps, the doctor checks and the other problems, as data, plus the two helpers that fill and
 * split their text. Pure and client-safe, no imports. The guide names no person, account or
 * repository: it uses placeholders such as `<owner>/<repo>` and `<agent-login>`. Every `command` is
 * one line, so its copy button copies exactly one command. `{tessera}` and `{runner-repo}` are
 * filled by `fillGuideText`; `{PORT}` is the runner's own placeholder and stays as written.
 */

export type SetupStepId =
  | "before"
  | "runner"
  | "api-key"
  | "agent-account"
  | "agent-token"
  | "agent-login"
  | "agent-identity"
  | "repos"
  | "access"
  | "connect"
  | "start"
  | "first-request";

export type GuideLink = { label: string; href: string };

export type GuideAction = {
  /** One instruction. `backticks` mark inline code. */
  text: string;
  /** A single-line shell command, shown with a copy button. */
  command?: string;
  /** A config.json fragment (several lines; valid JSON inside `{ }` once filled), shown with a copy button. */
  example?: string;
  link?: GuideLink;
};

export type GuideStep = { id: SetupStepId; title: string; why: string; actions: readonly GuideAction[]; doneWhen: string };

export type DoctorCheck = {
  name: string;
  /** `name` is a prefix (`repo ` + the repo's name). */
  isPrefix?: boolean;
  label: string;
  exitCode: 1 | 2 | 3;
  meaning: string;
  stepId: SetupStepId | null;
};

export type DoctorExitCode = { code: 0 | 1 | 2 | 3; meaning: string; stepId: SetupStepId | null };

export type OtherProblem = { id: string; title: string; fix: string; command?: string; stepId: SetupStepId | null };

/** The runner's repository. It has no public address yet; until it has, step 1 shows the placeholder. */
export const RUNNER_REPOSITORY: { readonly name: string; readonly url: string | null } = { name: "tessera-agents", url: null };
export const RUNNER_REPOSITORY_PLACEHOLDER = "<tessera-agents-url>";
/** Shown in step 9 when the page cannot tell this Tessera's port. */
export const TESSERA_URL_PLACEHOLDER = "http://127.0.0.1:<port>";

/** Fills `{tessera}` and `{runner-repo}`; leaves every other brace (`{PORT}`, JSON) alone. */
export function fillGuideText(text: string, context: { tesseraUrl: string | null }): string {
  return text.replaceAll("{tessera}", context.tesseraUrl ?? TESSERA_URL_PLACEHOLDER).replaceAll("{runner-repo}", RUNNER_REPOSITORY.url ?? RUNNER_REPOSITORY_PLACEHOLDER);
}

/** Splits text at backticks: a pair of backticks marks inline code. An unmatched backtick stays as text. Empty parts are dropped. */
export function splitInlineCode(text: string): { value: string; isCode: boolean }[] {
  const parts: { value: string; isCode: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    if (match.index > last) parts.push({ value: text.slice(last, match.index), isCode: false });
    parts.push({ value: match[1], isCode: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ value: text.slice(last), isCode: false });
  return parts;
}

export const GUIDE_INTRO: readonly string[] = [
  "The superagent is a separate program, the runner, that works on this Mac. You send it work items from Tessera, and it answers with comments and with pull requests from its own GitHub account. You set it up once, with the steps below.",
  "Run the commands in Terminal. Replace text in angle brackets, such as `<owner>/<repo>`, with your own values first.",
];

export const STATUS_NOTE =
  "While the runner runs, steps 2 to 7 have passed the checks it runs at start. Before that, `npm run doctor` checks them. Step 8 has no check here: its last command shows the result.";

export const SETUP_STEPS: readonly GuideStep[] = [
  {
    id: "before",
    title: "Before you start",
    why: "The runner works on this Mac and needs a few tools and two accounts. Setting it up takes about 30 minutes.",
    actions: [
      { text: "A Mac. The runner runs in the background through macOS's launchd." },
      { text: "Node 22.18 or newer. Check it:", command: "node --version" },
      { text: "git and the GitHub CLI `gh`, installed with Homebrew, so the runner finds them in `/opt/homebrew/bin` or `/usr/local/bin`. Check them:", command: "git --version && gh --version" },
      { text: "pnpm as well, if one of your repositories uses it." },
      { text: "A Claude Console account with credits. Step 2 makes the API key.", link: { label: "console.anthropic.com", href: "https://console.anthropic.com" } },
      { text: "A second GitHub account for the agent. Step 3 makes it." },
      { text: "At least 10 GB of free disk space." },
    ],
    doneWhen: "Both checks print a version, and Node is 22.18 or newer.",
  },
  {
    id: "runner",
    title: "Get the runner",
    why: "The runner, tessera-agents, takes your requests from Tessera, does the work in a sandbox and delivers pull requests.",
    actions: [
      { text: "Clone the tessera-agents repository into `~/src/tessera-agents`. Use exactly this folder: the runner's start file runs from it, and macOS keeps background jobs out of `~/Documents` and `~/Desktop`.", command: "git clone {runner-repo} ~/src/tessera-agents" },
      { text: "Install its packages.", command: "cd ~/src/tessera-agents && npm ci" },
      { text: "Create the runner's files. Setup never overwrites a file that exists, so you can run it again at any time.", command: "cd ~/src/tessera-agents && npm run setup" },
      { text: "Setup makes `~/.tessera-agents`: the `env` file for your API key, the `api-token` that Tessera uses to reach the runner, `config.json`, the agent's git settings and the start file `dev.tessera.agents.plist`. It also adds `~/.local/bin/gh-agent`, which runs gh as the agent, and the work folder `~/src/.agent-work`." },
    ],
    doneWhen: "Setup lists its files and ends with todo lines, and the status at the top shows \"Runner token found\".",
  },
  {
    id: "api-key",
    title: "Add a Claude API key",
    why: "The agents run on the Claude API. A workspace of their own, with a spend limit, caps what they can cost.",
    actions: [
      { text: "In the Claude Console, open Workspaces and create a workspace for the runner, for example \"Superagent\".", link: { label: "console.anthropic.com", href: "https://console.anthropic.com" } },
      { text: "Select the workspace, open Spend limits, and set a monthly limit and email alerts. The Default workspace takes no spend limit, and a workspace limit must be below your organisation's limit." },
      { text: "Create an API key in that workspace. A key stays in the workspace it was made in. The Console shows the key once, so copy it now." },
      { text: "Add the key to the runner's `env` file straight from the clipboard, then clear the clipboard. Never paste the key into a chat.", command: "printf 'ANTHROPIC_API_KEY=%s\\n' \"$(pbpaste)\" >> ~/.tessera-agents/env && pbcopy < /dev/null" },
      { text: "To change the key later, edit `~/.tessera-agents/env` in a plain-text editor. The runner reads the first line that starts with `ANTHROPIC_API_KEY=`." },
    ],
    doneWhen: "`npm run setup` no longer lists a todo to write `ANTHROPIC_API_KEY`.",
  },
  {
    id: "agent-account",
    title: "Make a GitHub account for the agent",
    why: "The agent pushes branches and opens pull requests as its own account. You can tell its work from yours, and it reaches only what you share with it.",
    actions: [
      { text: "Sign out of GitHub, or open a private window, and sign up for a new account, for example `<your-login>-agent`. GitHub allows one machine account beside your personal one, used only for automation.", link: { label: "github.com/signup", href: "https://github.com/signup" } },
      { text: "Give it an email address of its own. With Gmail, a plus address such as `<you>+agent@gmail.com` works." },
      { text: "Turn on two-factor authentication for it: Settings, then Password and authentication." },
    ],
    doneWhen: "You can sign in as the agent with two-factor authentication.",
  },
  {
    id: "agent-token",
    title: "Create the agent's token",
    why: "The runner acts on GitHub with a token of the agent account. It must be a classic token: a fine-grained token reaches only repositories owned by the account or organisation it was made for, not your repositories, where the agent is a collaborator.",
    actions: [
      { text: "Signed in as the agent, open the token settings and choose Generate new token, then Generate new token (classic).", link: { label: "github.com/settings/tokens", href: "https://github.com/settings/tokens" } },
      { text: "Name it, for example \"Tessera runner\", and pick an expiry date you will remember. When it expires, make a new one and repeat step 5." },
      { text: "Tick `repo` and `read:org`: gh refuses a classic token without `read:org`. Leave `workflow` unticked, so the agent cannot change your CI workflows." },
      { text: "Generate the token and copy it. GitHub shows it once." },
    ],
    doneWhen: "The token is in your clipboard. Use it in step 5 straight away.",
  },
  {
    id: "agent-login",
    title: "Log the agent in on this Mac",
    why: "`gh-agent` keeps the agent's login apart from your own gh login. The token goes into a file the agents' sandbox cannot read, not into your Keychain.",
    actions: [
      { text: "With the token still in the clipboard, run this. It reads the token from the clipboard, then clears the clipboard.", command: "pbpaste | ~/.local/bin/gh-agent auth login --with-token --insecure-storage && pbcopy < /dev/null" },
      { text: "Check who is logged in. It prints the agent's login.", command: "~/.local/bin/gh-agent api user --jq .login" },
    ],
    doneWhen: "The check prints the agent's login, not yours.",
  },
  {
    id: "agent-identity",
    title: "Tell the runner who the agent is",
    why: "The runner checks the agent's login, and it signs commits with the agent's GitHub noreply address, which it builds from the login and the numeric id.",
    actions: [
      { text: "Print the agent's login and id.", command: "~/.local/bin/gh-agent api user --jq '{login: .login, id: .id}'" },
      {
        text: "Open `~/.tessera-agents/config.json` in a plain-text code editor. TextEdit can turn quotes into curly quotes, which breaks the file. Set the `agent` block to the login and the id. The id is a number, without quotes.",
        example: '"agent": {\n  "login": "<agent-login>",\n  "githubId": 123456789,\n  "displayName": "Tessera Superagent"\n}',
      },
      { text: "Run setup again. While the agent's git settings still hold the example identity, it says `gitconfig` \"differs\" and lists a todo for it. Its todo about `githubRequesters` and `evidenceRepo` is for step 7.", command: "cd ~/src/tessera-agents && npm run setup" },
      { text: "If it does, delete those git settings and run setup once more. Setup makes them again with the agent's name and noreply address.", command: "rm ~/.tessera-agents/gitconfig && cd ~/src/tessera-agents && npm run setup" },
    ],
    doneWhen: "`npm run setup` has no todo about `agent.login`, `agent.githubId` or `gitconfig`.",
  },
  {
    id: "repos",
    title: "Choose the repositories",
    why: "The runner works only in the repositories listed in `config.json`, each from its own clone on this Mac.",
    actions: [
      {
        text: "Setup filled `repos` in `config.json` with one example entry, `my-app`. Replace it with your own repositories, one entry per repository, like this.",
        example:
          '"repos": [\n  {\n    "name": "my-app",\n    "github": "<owner>/my-app",\n    "path": "/Users/<you>/src/my-app",\n    "packageManager": "npm",\n    "lockfile": "package-lock.json",\n    "installCommand": ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],\n    "checks": {\n      "lint": ["npm", "run", "lint"],\n      "test": ["npm", "run", "test"]\n    },\n    "devCommand": ["npx", "next", "dev", "-H", "127.0.0.1", "-p", "{PORT}"]\n  }\n]',
      },
      { text: "`name` is a short lowercase name of your choice, from letters, digits and dashes. Tessera uses it in step 9. `github` is the repository as `<owner>/<repo>`, and `path` is the clone's full path: `~` does not work here." },
      { text: "`baseBranch` is the branch pull requests start from. It defaults to `main`. Set it if your repository's default branch has another name, such as `master`." },
      { text: "`checks` are the commands that must pass before a pull request. `devCommand` starts the app on `{PORT}` for screenshots; leave it out for a repository without screens. A plan picks its screenshot widths from `captureWidths`, 375 and 1440 by default. Screenshots are 900 px high; set `captureHeight` for another height. For pnpm, set `packageManager` to `pnpm`, `lockfile` to `pnpm-lock.yaml` and `installCommand` to `[\"pnpm\", \"install\", \"--frozen-lockfile\", \"--ignore-scripts\"]`." },
      { text: "Notes for the agents about a repository, such as rules to follow or what a finished change includes, go under Team sections on the superagent screen once a project is mapped to it in step 9." },
      { text: "Create a private repository for screenshots on GitHub, for example `<owner>/agent-evidence`, and tick Add a README so it has a main branch. The runner pushes screenshots of screen changes there." },
      {
        text: "Set `githubRequesters` to your own GitHub login, not the agent's, so the runner takes your pull request reviews and comments as yours, and `evidenceRepo` to the screenshot repository.",
        example: '"githubRequesters": ["<your-login>"],\n"evidenceRepo": "<owner>/agent-evidence"',
      },
      { text: "Clone each repository into `~/src` with its https address. The runner's check wants https. Keep these clones for the runner, and work in your own checkout elsewhere.", command: "git clone https://github.com/<owner>/<repo>.git ~/src/<repo>" },
      { text: "Optional: install packages in each clone once. The runner then copies them instead of installing for every request.", command: "cd ~/src/<repo> && npm ci" },
    ],
    doneWhen: "`npm run doctor` shows `ok` for `your account` and for `repo <name>` of every repository.",
  },
  {
    id: "access",
    title: "Give the agent access",
    why: "The agent pushes `agent/*` branches and opens draft pull requests, so it needs Write access to each repository and to the screenshot repository. Never give it more.",
    actions: [
      { text: "From your own account, open each repository's Settings, then Collaborators (Collaborators and teams in an organisation), and add the agent. In an organisation, give it the Write role, never Admin." },
      { text: "As the agent, list its invitations. Each line shows an invitation's number and repository.", command: "~/.local/bin/gh-agent api user/repository_invitations --jq '.[] | \"\\(.id) \\(.repository.full_name)\"'" },
      { text: "Accept each invitation by its number.", command: "~/.local/bin/gh-agent api -X PATCH user/repository_invitations/<invitation-number>" },
      { text: "Check the access for each repository. It prints true.", command: "~/.local/bin/gh-agent api repos/<owner>/<repo> --jq .permissions.push" },
      { text: "Check what a push to an `agent/*` branch starts: GitHub Actions workflows and preview deploys such as Vercel or Netlify. Code the agent wrote runs there with that workflow's secrets. Keep secrets to workflows that run on main, or turn previews off for `agent/*` branches." },
      { text: "If your GitHub plan allows it, protect each repository's main branch with a rule that requires a pull request. Leave the screenshot repository's main unprotected: the runner pushes to it directly." },
    ],
    doneWhen: "The access check prints true for every repository and for the screenshot repository.",
  },
  {
    id: "connect",
    title: "Connect Tessera and the runner",
    why: "The runner reads and writes work items through Tessera's MCP address, and this Tessera shows and steers the runner on its control screen.",
    actions: [
      {
        text: "In `config.json`, set the `tessera` block to this Tessera's address. Keep `requesterIds` as it is: it holds Tessera's own user id, which is the same in every Tessera. `clientRef` lets the runner retry a comment without posting it twice.",
        example: '"tessera": {\n  "mcpUrl": "{tessera}/api/mcp",\n  "appUrl": "{tessera}",\n  "requesterIds": ["00000000-0000-7000-8000-000000000001"],\n  "clientRef": true\n}',
      },
      { text: "Tessera finds the runner's token by itself. It reads `~/.tessera-agents/api-token` on every call and never stores it. If Tessera runs with `TESSERA_AGENTS_TOKEN_FILE` set, it reads that file instead." },
      { text: "On the control screen, open Settings, then Projects and repositories. Leave Runner URL empty: it means `http://127.0.0.1:3090`, the runner's address. If you changed `api.port` in `config.json`, enter `http://127.0.0.1:<port>` instead.", link: { label: "Open the control screen", href: "/agents/superagent" } },
      { text: "Add one row per project. In Repository, type the repository's `name` from `config.json`, such as `my-app`, or its `<owner>/<repo>`. The runner ignores a repository that is not in `config.json`. Then choose Save mapping." },
    ],
    doneWhen: "The status at the top shows at least one mapped project.",
  },
  {
    id: "start",
    title: "Check and start the runner",
    why: "`npm run doctor` runs the checks the runner runs when it starts. launchd then keeps the runner going in the background, also after a crash or a restart of the Mac.",
    actions: [
      { text: "Run the checks. Each line starts with `ok` or `FAIL`. Fix every `FAIL` with the list under \"When a check fails\", and run them again until the exit code is 0.", command: "cd ~/src/tessera-agents && npm run doctor; echo \"exit code $?\"" },
      { text: "Start the runner. The command copies the start file into `~/Library/LaunchAgents`, the folder macOS starts background jobs from when you log in, so the runner also comes back after a restart. If launchctl says the service is already loaded, use the restart command below instead.", command: "cp ~/.tessera-agents/dev.tessera.agents.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.tessera.agents.plist" },
      { text: "Watch its log. It shows \"control API on 127.0.0.1:3090\", then \"started as\" once it reached Tessera. Press Control-C to stop watching.", command: "tail -f ~/.tessera-agents/logs/runner.log" },
      { text: "Restart it after you change `config.json`.", command: "launchctl kickstart -k gui/$(id -u)/dev.tessera.agents" },
      { text: "Stop it. It starts again when you log in next.", command: "launchctl bootout gui/$(id -u)/dev.tessera.agents" },
      { text: "To keep it stopped after a restart too, remove its copy of the start file as well.", command: "rm ~/Library/LaunchAgents/dev.tessera.agents.plist" },
      { text: "A failed setup check stops the runner, and launchd leaves it stopped. Fix the check, then restart it." },
      { text: "The runner appears on the Agents page as `mcp:superagent`. Leave its access at write." },
    ],
    doneWhen: "The status at the top shows \"Runner running and healthy\" and \"The superagent has connected to Tessera\".",
  },
  {
    id: "first-request",
    title: "Send a first request",
    why: "Start small, so you see the whole loop at little cost: the request, the plan, the work, the review and the pull request.",
    actions: [
      { text: "Open the chat and start a new chat in a mapped project, or choose Send to superagent in a work item's More menu. Assigning or mentioning the superagent on an item works too.", link: { label: "Open the chat", href: "/agents/superagent/chat" } },
      { text: "Ask for something small first: a question about the code, or a fix in one file." },
      { text: "The runner only sees work sent after it first started. For an item assigned before, remove the superagent and assign it again." },
      { text: "By default a request may spend $2 (size S), $10 (M) or $30 (L), all requests together $50 a day, and 2 run at the same time. An L request waits for your sign-off before the work starts. Change these on the control screen under Settings, then Runner. Pause, under Health, holds new work." },
      { text: "The superagent's questions show up in the chat. Answer them there." },
    ],
    doneWhen: "The request shows on the control screen, and its chat shows the superagent's replies.",
  },
];

export const TROUBLESHOOTING_INTRO =
  "`npm run doctor` prints one line per check, `ok` or `FAIL` with a reason, and ends with an exit code. While the runner runs, the control screen's Health section shows the same checks.";

export const DOCTOR_CHECKS: readonly DoctorCheck[] = [
  { name: "config", label: "config", exitCode: 3, meaning: "`~/.tessera-agents/config.json` is missing or not valid. `npm run setup` says what is wrong.", stepId: "agent-identity" },
  { name: "node", label: "node", exitCode: 3, meaning: "Node is too old. The runner needs 22.18 or newer.", stepId: "before" },
  { name: "agent account", label: "agent account", exitCode: 3, meaning: "`agent.login` or `agent.githubId` in `config.json` still holds the example value.", stepId: "agent-identity" },
  { name: "your account", label: "your account", exitCode: 3, meaning: "`githubRequesters` or `evidenceRepo` in `config.json` still holds the example value `CHANGE-ME`, or `githubRequesters` is empty, holds something that is not a GitHub login, or names the agent.", stepId: "repos" },
  { name: "api key", label: "api key", exitCode: 3, meaning: "There is no `ANTHROPIC_API_KEY=` line in `~/.tessera-agents/env`, or other users can read the file.", stepId: "api-key" },
  { name: "api token", label: "api token", exitCode: 3, meaning: "The runner's token file is missing, or other users can read it. Run `npm run setup` again.", stepId: "runner" },
  { name: "gitconfig", label: "gitconfig", exitCode: 3, meaning: "The runner's git settings lack the agent's sign-in helper, or still hold the example identity. Delete `~/.tessera-agents/gitconfig` and run `npm run setup` again.", stepId: "agent-identity" },
  { name: "gh-agent login", label: "gh-agent login", exitCode: 3, meaning: "The agent is not logged in with `gh-agent`, or another account is.", stepId: "agent-login" },
  { name: "repo ", isPrefix: true, label: "repo <name>", exitCode: 3, meaning: "There is no clone at the `path` in `config.json`, or its origin is not `https://github.com/<owner>/<repo>`.", stepId: "repos" },
  { name: "sandbox", label: "sandbox", exitCode: 3, meaning: "The sandbox could not run a command, or let one read the runner's token. Run `npm ci` in `~/src/tessera-agents` again.", stepId: "runner" },
  { name: "disk", label: "disk", exitCode: 3, meaning: "There is less free disk space than the runner needs, 10 GB by default.", stepId: "before" },
  { name: "tessera", label: "tessera", exitCode: 1, meaning: "The runner cannot reach Tessera at `tessera.mcpUrl`. Check the address and that Tessera is running.", stepId: "connect" },
  { name: "github", label: "github", exitCode: 1, meaning: "GitHub calls as the agent fail, or `gh-agent` is logged in as another account. An expired token fails here too: make a new one in step 4.", stepId: "agent-login" },
  { name: "intake", label: "intake", exitCode: 2, meaning: "Tessera's history went back, for example after restoring a backup. The runner stopped taking new work so it does not act twice. It has no reset command yet.", stepId: null },
];

export const DOCTOR_EXIT_CODES: readonly DoctorExitCode[] = [
  { code: 0, meaning: "All checks pass. Start the runner.", stepId: "start" },
  { code: 1, meaning: "Tessera or GitHub does not answer. The runner holds work until both do.", stepId: null },
  { code: 2, meaning: "Tessera's history went back. The runner takes no new work.", stepId: null },
  { code: 3, meaning: "A setup check failed. The runner does not start until you fix it.", stepId: null },
];

export const OTHER_PROBLEMS: readonly OtherProblem[] = [
  {
    id: "screenshots",
    title: "A screen change is blocked with \"screenshot tool not installed\"",
    fix: "The runner takes screenshots with Playwright, which it does not install itself yet. Install it in the runner's folder, then restart the runner. Run this again after `npm ci` there.",
    command: "cd ~/src/tessera-agents && npm install --no-save playwright && npx playwright install chromium",
    stepId: "start",
  },
  {
    id: "node-update",
    title: "The runner stopped starting after a Node update",
    fix: "Its start file names the Node that ran setup. Make a new start file, then restart the runner.",
    command: "rm ~/.tessera-agents/bin/run && cd ~/src/tessera-agents && npm run setup",
    stepId: "start",
  },
  {
    id: "not-connected",
    title: "Send to superagent stays off",
    fix: "The superagent has not reached Tessera yet. Check `mcpUrl` in step 9, and that the runner runs.",
    stepId: "connect",
  },
];
