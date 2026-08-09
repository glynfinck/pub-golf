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
          {APP_NAME} is a personal project, not a company. It is run by Glyn
          Finck, who is the data controller for anything below, and who can be
          reached at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>

      <Section heading="If you join as a guest">
        <p>
          Joining a round needs a code and a name — no account, no email, no
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
          <b>{APP_NAME} never sends email</b> — there is no mailing list, no
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
          approximate location your network gives away — city-level, from the
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
          <b>a self-serve control is on the way</b> — until it lands, this is
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
          no archive — it is a page in a repository, and its history is the
          repository&apos;s.
        </p>
      </Section>
    </>
  );
}
