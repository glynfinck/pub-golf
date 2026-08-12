import { CONTACT_EMAIL, LegalHeader, Points, Section } from "@/app/legal/parts";
import { APP_NAME } from "@/lib/config";

export const metadata = {
  title: "Privacy",
  description: `What ${APP_NAME} keeps, and what it doesn't.`,
};

/**
 * Short because the app genuinely is. Every claim here is a claim about code
 * in this repo — if a flow changes, this page changes with it. The two that
 * are easiest to break by accident: "no email is ever sent" (there is no SMTP
 * anywhere, deliberately — see DEPLOYMENT.md) and "no analytics" (there is no
 * third-party script on any page today).
 */
export default function PrivacyPage() {
  return (
    <>
      <LegalHeader
        eyebrow="House papers"
        title="Privacy"
        standfirst="A scorecard for a night out. It keeps names and swigs, and not much else."
      />

      <Section heading="Who this is">
        <p>
          {APP_NAME} is a personal project, not a company. It is run by one
          person, who is the data controller for anything below, and who can be
          reached at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>

      <Section heading="If you join as a guest">
        <p>
          Joining a round needs a code and a name: no account, no email, no
          password. You get an anonymous session so the database can tell your
          card from everyone else&apos;s.
        </p>
        <p>
          <b>The name you type is the whole record.</b> Type a nickname and
          that is genuinely all we have.
        </p>
      </Section>

      <Section heading="If you sign in with Google">
        <p>Hosting a round needs a Google sign-in. From it we store:</p>
        <Points>
          <li>
            <b>Your display name</b>, which is what appears on cards. You can
            change it in Profile at any time.
          </li>
          <li>
            <b>An account id</b>, so your rounds are still yours next time.
          </li>
        </Points>
        <p>
          Google also returns your email address, and our authentication
          database holds it because that is where a Google sign-in puts it.
          Nothing in the app reads it, and{" "}
          <b>{APP_NAME} never sends email</b>. There is no mailing list, no
          notification, no password reset, and no mail server configured at
          all. If that ever changes, this page changes first.
        </p>
      </Section>

      <Section heading="What a round records">
        <p>
          The card, essentially: swigs per hole, penalties and who called
          them, mulligans, handicaps, and the pubs on the course with their
          Google Place ids. Plus the times things happened, because the hole
          timer is a shared deadline everyone counts down to.
        </p>
        <p>
          Courses you build are stored against your account: a name, the pubs,
          their order and their par.
        </p>
      </Section>

      <Section heading="Pubs, maps and where you are">
        <p>
          Searching for a pub sends your search text to the Google Places API
          from our server. To aim that search at the right city, we read the
          approximate location your network gives away: city-level, from the
          request headers, never stored.
        </p>
        <p>
          The map can also ask your browser for your exact position. That is
          the browser&apos;s own permission prompt, it is always your choice,
          and the coordinates are used to frame that one search and then
          discarded.
        </p>
        <p>
          Google&apos;s own terms apply to what they do with a query. We send
          them the words you typed and roughly where to look, and nothing that
          identifies you.
        </p>
      </Section>

      <Section heading="If you ask the caddy to plan a course">
        <p>
          The caddy is the paid extra that plans a course for you. What you type
          into it — the area, the kind of night, the hole count, and anything
          you add in your own words — is sent to an AI provider that generates
          the card. Today that is <b>Anthropic</b>, reached through Vercel&apos;s
          AI Gateway; both are processors acting for this project.
        </p>
        <p>
          <b>Nothing identifying goes with it.</b> Not your name, not your
          account, not your email. What the model sees is the brief and a list
          of real pubs near where you said, and it never invents one — it picks
          from what Google returned.
        </p>
        <p>
          We keep a record of each planning session: the brief, the card it
          produced, what it cost us to run, and a note of the steps the caddy
          took to get there — which pubs it chose, which it ruled out and why.
          That record is what lets us answer &ldquo;this course is wrong&rdquo;
          when you tell us so, and it is how the caddy gets better at the job.
          It is yours, it is visible to nobody else, and it goes when your
          account does.
        </p>
        <p>
          <b>The pub data itself is not kept that long.</b> Google&apos;s
          descriptions, ratings and review snippets are held only for as long as
          you are working on that course — about half a day — and are then
          deleted by a job that runs every hour. If you come back later to
          change the course, the caddy fetches them again rather than keeping
          an old copy.
        </p>
        <p>
          What does stay is the pub itself: its name, address and map position,
          in a shared list this app keeps so that a course, a scorecard and a
          round played years apart all point at the same door. It holds nothing
          about you and nothing about a night out — the same handful of facts a
          street sign carries — and it is shared across everyone rather than
          kept per person.
        </p>
      </Section>

      <Section heading="If you report a bug">
        <p>
          The report goes to a <b>public</b> issue tracker, so the sheet says so
          before you send. What you write is printed there; what stays private
          is everything that would identify you or your round — your name, your
          account, and above all a round&apos;s join code, which is stripped out
          before anything leaves.
        </p>
        <p>
          A report filed from a course the caddy planned also records which
          planning session — and which card in it — the report was about, so we
          can look at what went wrong. Those links stay on our side and never
          appear on the public issue.
        </p>
      </Section>

      <Section heading="Cookies and tracking">
        <p>
          One cookie, holding your session. That is what keeps your seat at a
          round when you lock your phone.
        </p>
        <p>
          <b>No analytics, no advertising, no third-party trackers</b>, and
          nothing that follows you off this site.
        </p>
      </Section>

      <Section heading="Where it lives, and for how long">
        <p>
          Rounds are stored in a Postgres database hosted by Supabase in
          London, and the app is served by Vercel. Both are processors acting
          for this project.
        </p>
        <p>
          Data stays until it is deleted. A host can delete a round, which
          takes its scores with it, and you can ask us to delete everything
          tied to your account.
        </p>
      </Section>

      <Section heading="Deleting your data">
        <p>
          Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and it
          will be done. That is a person answering rather than a button, and{" "}
          <b>a self-serve control is on the way</b>. Until it lands, this is
          the honest description of the route.
        </p>
        <p>
          Under UK data protection law you can also ask what is held, have it
          corrected, or have a copy of it. Same address, same answer.
        </p>
      </Section>

      <Section heading="Age">
        <p>
          {APP_NAME} scores a drinking game and is not for under-18s. See the{" "}
          <a href="/legal/terms">terms</a>.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          If this page changes, the date at the top changes with it. There is
          no archive; it is a page in a repository, and its history is the
          repository&apos;s.
        </p>
      </Section>
    </>
  );
}
