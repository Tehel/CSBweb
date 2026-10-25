# Setup your own CSBweb in 29ish easy steps

This guide builds a CSBweb instance from nothing: a Linux server running the game in Docker
behind HTTPS, with FTL's games on it and you as its moderator. `doc/DEPLOYMENT.md` explains
what each part is and why. This page is only the order to do things in.

The examples use `you` as your login on the server, `csbweb.example.org` as its address
and `~/csbweb` as the stack's folder. Replace them with your own.

**What you need before you start:**

- **A Linux server** you can SSH into with a key, with a login whose uid is 1000 (below).
  The image is built on your own machine and shipped as a file, so the server and your
  machine must have the same architecture, both x86-64 or both ARM64.
- **A domain name** pointing at the server. HTTPS is required, not optional: the page uses
  `crypto.subtle` and `crypto.randomUUID`, which a browser only offers in a secure context.
- **On your machine:** git, Node.js 24, Docker, `7z` (7-Zip or p7zip), `ssh`, and `rsync`
  for the backups.

## On your machine: the code and the game files

1. **Clone the repository.**

   ```bash
   git clone https://github.com/Tehel/csbweb.git && cd csbweb
   ```

2. **Install its packages:** `npm ci`.

3. **Fetch the game files:** `npm run fetch-gamefiles`. It downloads FTL's games and a few
   fans' dungeons from where the community keeps them, checks every file against its
   SHA-256, and writes them under `tools/fixtures/gamefiles/`. Step 22 installs them from
   there.

## On the server: a home for the stack

4. **Log in:** `ssh you@csbweb.example.org`.

5. **Check your uid:** `id -u` should print `1000`. The container runs as uid 1000 and
   writes to the stack's `stats/` and `gamefiles/` folders, which your login creates. On
   Ubuntu, the first user made has uid 1000. With another uid, give both folders to 1000
   after step 22 (`sudo chown -R 1000:1000 ~/csbweb/stats ~/csbweb/gamefiles`).

6. **Install Docker and Compose.** Follow Docker's own instructions
   (<https://docs.docker.com/engine/install/>), or on Ubuntu run
   `sudo apt install docker.io docker-compose-v2`. Check with `docker compose version`.
   Compose v1's `docker-compose` works too: the scripts use it when the server has it.

7. **Let your login run Docker:** `sudo usermod -aG docker $USER`, then log out and back
   in. `docker ps` should answer without `sudo`.

8. Optional: **Install SQLite's shell:** `sudo apt install sqlite3`. You use it to look at the
   store by hand (step 23). The server itself needs nothing but Docker.

9. **Check the disk space:** `df -h ~` should show at least 500 MB free. That covers the
   image, the game files, the players' uploads and two weeks of nightly backups.

10. **Make the stack's folder**, and note its absolute path for step 14:

    ```bash
    mkdir -p ~/csbweb/{gamefiles,stats,files} && cd ~/csbweb && pwd
    ```

11. **Write the stack's `.env`.** Compose refuses to start without it, even when it is
    empty. It also holds secrets, so make it readable by you alone:

    ```bash
    cat > ~/csbweb/.env <<'EOF'
    # The moderators: <playerId>[=<alias>], comma-separated (step 19)
    MODERATOR_PLAYER_IDS=
    # The time zone the notifications are dated in
    TZ=Europe/Paris
    # Optional: an ntfy topic told of every change to the data sets
    # NTFY_URL=https://ntfy.example.org/csbweb
    # NTFY_USER=
    # NTFY_PASS=
    # Optional: the loopback port the container is published on (8085)
    # CSBWEB_PORT=8085
    EOF
    chmod 600 ~/csbweb/.env
    ```

12. **Put HTTPS in front.** The container listens on `127.0.0.1:8085` only, so a reverse
    proxy on the server faces the internet. With nginx and Let's Encrypt
    (`sudo apt install nginx certbot python3-certbot-nginx`), write
    `/etc/nginx/sites-available/csbweb`:

    ```nginx
    server {
        server_name csbweb.example.org;
        location / {
            proxy_pass http://127.0.0.1:8085;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            client_max_body_size 32m;
        }
    }
    ```

    Enable it and get its certificate:

    ```bash
    sudo ln -s /etc/nginx/sites-available/csbweb /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
    sudo certbot --nginx -d csbweb.example.org
    ```

    `X-Real-IP` is what the rate limits count, and `client_max_body_size` lets a player's
    dungeon through (`doc/DEPLOYMENT.md` → "The site").

13. **Log out.** The remaining steps start from your machine.

## Back on your machine: the first deploy

14. **Write the local `.env`:** `cp .env.template .env`, then set `DEPLOY_HOST`
    (`you@csbweb.example.org`) and `DEPLOY_DIR` (the absolute path from step 10). Git
    ignores this file.

15. **Deploy:** `npm run deploy`. It builds the image, copies it and the compose file into
    `DEPLOY_DIR`, and starts the stack. Later deploys are the same command.

16. **Check that the server answers:**

    ```bash
    curl -s https://csbweb.example.org/api/health      # {"ok":true}
    ssh you@csbweb.example.org 'cd ~/csbweb && docker compose logs --tail 5'
    ```

    The log's last line is `Listening on port 8085: …`, with `no set` for now.

## In your browser: become the moderator

17. **Open `https://csbweb.example.org/`.** The welcome page is empty but for
    "+ Add my own", since the site has no game yet.

18. **Get your `playerId`.** Open the browser's console on that page (F12, then Console)
    and run the command below. It prints the id this browser keeps, and draws one, as the
    page would, if the browser has none yet. Chrome asks you to type `allow pasting` before
    it accepts a pasted command.

    ```js
    localStorage.getItem('csbweb_player_v1') || (localStorage.setItem('csbweb_player_v1', crypto.randomUUID()), localStorage.getItem('csbweb_player_v1'))
    ```

    The id is a secret: whoever sends it is a moderator. It belongs to this browser on this
    address. Clearing the site's data loses it, and another browser has its own.

19. **Name yourself a moderator.** On the server, edit `~/csbweb/.env`:

    ```
    MODERATOR_PLAYER_IDS=<the id from step 18>=YourName
    ```

    The alias after `=` is what notifications call you, and it is optional. Several
    moderators are separated by commas.

20. **Recreate the container** so that it reads the new `.env`. `restart` keeps the old
    environment, so take the stack down and up:

    ```bash
    cd ~/csbweb && docker compose down && docker compose up -d
    ```

21. **Reload the welcome page.** A switch at its top right corner, shown to moderators
    only, says it worked.

## The official games

22. **Install them.** On your machine, run:

    ```bash
    npx tsx utils/install-official-sets.ts --dry-run   # what it would do
    npx tsx utils/install-official-sets.ts
    ```

    It offers each of FTL's games that `tools/data-sets.json` lists, one at a time: Dungeon
    Master as each of the six Atari disks holds it (1.0 twice, 1.1, 1.2, the German 1.2 and
    the French 1.3), CSBWin's own two, the Kid's dungeon, and Chaos Strikes Back. You can
    rename one and edit its description and authors before you say yes. Each yes copies
    the set's files to the server and writes its row: approved, official, and owned by the
    site. Say yes to `dm-atari` and `csb` at least: a player's dungeon without its own
    graphics plays one of theirs, `dm-atari`'s being CSBWin's Dungeon Master's with three
    pictures from the 1.2 disk (`doc/PROVEN_FACTS.md`). The manifest's default set, the 1.2 disk's Dungeon Master,
    becomes the one the welcome page selects on a first visit. A second run offers only
    what is not installed yet.

23. **Look at the store**, if you like: on the server,
    `sqlite3 ~/csbweb/stats/stats.db 'SELECT id, name, status, official, hidden FROM data_sets'`.

24. **Reload the welcome page.** The games are listed under "Official games", the six
    disks first. CSBWin's own two Dungeon Masters, `dm-atari` and `dm-windows`, are
    installed hidden.
    As a moderator you see them, their names in purple, and `?dungeon=<id>` plays them for
    anyone. The eye on a tile hides or shows it.

25. **Polish them on the site.** The pen on a tile edits a set's name, description,
    authors and files. The book on a tile offers its files as a zip, and to a moderator
    its ADD attaches a document, such as a manual. Every change takes effect at once,
    with no restart.

26. **Play.** Pick Dungeon Master ST 1.2, then PLAY.

## Keeping it

27. **Back the store up every night.** On the server, `crontab -e`, and add this line, its
    paths yours:

    ```
    17 3 * * * cd /home/you/csbweb && docker compose exec -T csbweb node --disable-warning=ExperimentalWarning server/backup.ts < /dev/null >> stats/backup.log 2>&1 && find stats/backups -name '*.db' -mtime +14 -delete
    ```

    It snapshots the store while the server keeps serving, copies the folders of the
    players' sets, and keeps two weeks of snapshots (`doc/DEPLOYMENT.md` → "Backups").
    `< /dev/null` is not optional. Run the line by hand once, then check that
    `ls ~/csbweb/stats/backups/` shows the snapshot.

28. **Copy the backups home**, now and then: `utils/pull-backups.sh` on your machine
    copies `stats/backups/` with `rsync` to `../backups/csbweb/`, beside the checkout, or
    to `BACKUP_PULL_DIR`.

29. **Update** whenever you like: `git pull && npm run deploy`. A deploy keeps the store,
    the game files and the `.env`, and the page is down for a few seconds while the
    container is replaced.

**Optionally, the fans' dungeons.** `utils/submit-forum-dungeons.ts` offers the instance
the CSBWin dungeons that the Dungeon Master forum lists. It submits them as a player would,
so each arrives pending, and the tick on its tile approves it:

```bash
npx tsx utils/submit-forum-dungeons.ts --instance https://csbweb.example.org --player <your playerId>
```

Those dungeons belong to their authors, so offering them is your call. The server takes
five submissions an hour from one address: when the script stops at the sixth, run it
again an hour later.
