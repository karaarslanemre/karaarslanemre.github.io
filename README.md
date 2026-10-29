# emrekaraarslan.com

Emre Karaarslan's personal site: an About me page, a log of published writing, and the books he's reading.

Once it's set up, you update the site from **Pages CMS**, a free web editor. Every save publishes the change to the live site within a minute or two. You don't need Claude or any code for day-to-day edits.

---

## Part 1: Put the site online (one time, about 20 minutes)

### 1. Create a GitHub account
Sign up at [github.com](https://github.com) if you don't have an account. GitHub stores the site's files and hosts the site for free.

### 2. Create the repository
1. Click **New repository**.
2. Name it exactly **`YOUR-USERNAME.github.io`**, replacing YOUR-USERNAME with your GitHub username. With this name, the site works at that address before your domain is connected.
3. Choose **Public**, then click **Create repository**.

### 3. Upload the files
1. Unzip the folder you received.
2. On a Mac, press **Cmd + Shift + .** in Finder to show hidden files. Files that start with a dot (`.github`, `.pages.yml`, `.gitignore`) are required.
3. On the new repository's page, click **uploading an existing file**.
4. Drag in **everything inside** the unzipped folder, not the folder itself, then click **Commit changes**.

### 4. Turn on hosting
1. In the repository, go to **Settings → Pages**.
2. Under **Source**, choose **GitHub Actions**.
3. Go to the **Actions** tab, open **Deploy to GitHub Pages**, and click **Run workflow** if it hasn't already started.
4. When the run shows a green check, your site is live at `https://YOUR-USERNAME.github.io`.

### 5. Connect emrekaraarslan.com
1. In **Settings → Pages → Custom domain**, enter `emrekaraarslan.com` and click **Save**.
2. At your domain registrar, open the DNS settings and add these records:

   | Type  | Name  | Value                     |
   | ----- | ----- | ------------------------- |
   | A     | @     | 185.199.108.153           |
   | A     | @     | 185.199.109.153           |
   | A     | @     | 185.199.110.153           |
   | A     | @     | 185.199.111.153           |
   | CNAME | www   | YOUR-USERNAME.github.io   |

   If your domain is on Cloudflare, set these records to **DNS only** (grey cloud) so GitHub can issue the security certificate.
3. DNS changes can take up to a few hours. Once the domain check passes, tick **Enforce HTTPS** in **Settings → Pages**.

These records don't affect email. Email forwarding for me@emrekaraarslan.com uses separate (MX) records.

### 6. Connect the editor
1. Go to [app.pagescms.org](https://app.pagescms.org) and sign in with GitHub.
2. When asked, install the Pages CMS app and give it access to your `YOUR-USERNAME.github.io` repository.
3. Open the repository. You'll see three sections: **Writing**, **About me**, and **Site settings**.

---

## Part 2: Updating the site

Every save in Pages CMS republishes the site. Changes show up within a minute or two.

**Add a piece published somewhere else** (like your Contrary Research report)
Writing → **Add an entry**. Fill in the title, date and one-line summary. Paste the full URL in **External link** and the outlet in **Published in**. Save.

**Write a post on your own site**
Writing → **Add an entry**. Leave **External link** empty and write in the **Post** box. Tick **Draft** to keep it hidden while you work. Untick it and save to publish.

**Remove a piece**
Open it in Writing and delete it. To hide it without deleting, tick **Draft**.

**Add a book**
Books → **Add an entry**. Type the title and author, choose **Reading** or **Read**, and paste a quote you liked into **Quote** (optional). Save. The cover is found automatically when the site updates. If it shows the wrong edition, add the book's ISBN, or upload your own image in **Cover image**. To move a book from Reading to Read, change its status and save.

**Edit your About text**
About me → edit the text → Save. **Big headline** is the large text at the top of the page; leave it empty to show the page title (About Me).

**Change the note beside Writing, your email, LinkedIn or footer note**
Site settings → edit → Save. LinkedIn and X only appear once you fill them in.

**Images in posts**
Use the image button in the Post editor. Uploads are stored in `public/images`.

**Tables**
Switch the Post editor to its Markdown view and use the table format shown in the example post.

There's an example post in Writing called "How a post on this site looks". It's a draft, so it isn't on the live site. Use it as a formatting reference, or delete it.

---

## Changing fonts or colors

Fonts and colors are set at the top of `src/styles/global.css`. The font files load from Google Fonts through the link in `src/layouts/Base.astro`. To try a different font, pick one on [fonts.google.com](https://fonts.google.com), update the link, and change the name in `global.css`. You can edit both files directly on GitHub with the pencil icon.

## Where things live

| What | File |
| ---- | ---- |
| Writing entries | `src/content/writing/` (one file per entry) |
| Books | `src/content/books/` (one file per book) |
| About text | `src/data/about.md` |
| Name, notes, email, links | `src/data/site.json` |
| Fonts and colors | `src/styles/global.css` |
| Page layout | `src/layouts/Base.astro`, `src/pages/` |
| Editor setup | `.pages.yml` |
| Publishing | `.github/workflows/deploy.yml` |

## Running it on your own computer (optional)

You need [Node.js](https://nodejs.org) 22.12 or newer. In this folder, run `npm install`, then `npm run dev`, then open the address it prints.
