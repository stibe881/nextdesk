# App Store Review – Notes (Entwurf)

Text für **App Store Connect → App Review Information → Notes**. Platzhalter in `<…>` vor dem Einreichen ersetzen.

---

## 1. Screen recording

A screen recording captured on a physical iPhone running iOS <version> is available here: <link to video>

It starts with launching the app and shows: sign-in with the demo account, the home dashboard, the ticket list, opening a ticket, replying to a ticket, creating a new ticket (incl. photo attachment), notifications, the knowledge base, settings and sign-out.

- Account registration: not available in the app. Accounts are created by the customer organisation's administrator (invitation) or provisioned through the organisation's Microsoft Entra ID single sign-on. The email sign-in link only works for existing accounts.
- Account deletion: <see note below>
- User-generated content: tickets and ticket replies are only visible to members of the same organisation (tenant) with the relevant permission. There is no public or cross-organisation content, no social feed and no contact between unrelated users.
- Paid content: the app contains no in-app purchases, paid features or links to purchase. Organisations license nextDesk under a separate business agreement.

## 2. Purpose and target audience

nextDesk is an IT service management (helpdesk / ticketing) platform by Gross ICT, Switzerland. Organisations use it to receive, track and resolve IT support requests.

The iOS app lets employees of customer organisations
- submit and follow their own support tickets (requesters), and
- let IT staff work on tickets while away from their desk: view queues, reply, change status/priority, receive push notifications, look up knowledge base articles and IT assets (agents).

Problem solved: support requests no longer get lost in emails and phone calls; IT staff can react to urgent incidents from anywhere.

## 3. How to access the app

Demo account (password sign-in):

1. Open the app and tap **"Mit Passwort anmelden"** (sign in with password).
2. Email: `<demo email>`
3. Password: `<demo password>`

The demo account belongs to a demo organisation with sample tickets, knowledge articles and assets. It has the agent role, so all main features are visible. <Optional: second requester account `<email>` / `<password>` to show the requester view.>

"MIT SSO ANMELDEN" (Microsoft single sign-on) only works for organisations that have connected their own Microsoft Entra ID; please use the password sign-in above. The UI language is German (Swiss).

## 4. External services

- Supabase (hosted in Zurich, Switzerland, eu-central-2): database, authentication, file storage, server functions
- Microsoft Entra ID (Azure AD): optional single sign-on for organisations; optional directory/Intune sync configured by the organisation
- Apple Push Notification service via Expo Push Service: ticket notifications
- <Anthropic Claude API: AI-assisted text suggestions for knowledge articles in the web app – only if used/visible in the iOS app>
- No payment processors, no advertising or tracking SDKs.

## 5. Regional differences

The app works the same in all regions. Content is in German; data is stored in Switzerland.

## 6. Regulated industry / third-party material

nextDesk does not operate in a regulated industry and does not contain protected third-party content. All content is created by the customer organisations themselves.

---

## Guideline 3.2 – Business apps

Apple weist darauf hin, dass Apps nur für bestimmte Firmen über **Custom Apps (Apple Business Manager)** oder **Unlisted App Distribution** verteilt werden sollen. Falls Apple das erneut beanstandet:

- nextDesk ist ein Produkt für viele unabhängige Kundenfirmen (B2B-SaaS, wie z. B. Jira, Zendesk, Freshdesk). Das in den Notes betonen.
- Alternative: Unlisted App Distribution beantragen – die App ist dann nur per Link installierbar, aber nicht im Store auffindbar.
