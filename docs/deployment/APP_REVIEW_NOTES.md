# App Store Review – Notes

Text für **App Store Connect → App Review Information → Notes**. Platzhalter in `<…>` vor dem Einreichen ersetzen. Demo-Zugang zusätzlich unter **Sign-In Information** eintragen, das Bildschirmvideo unter **Attachment** hochladen.

---

```
Thank you for your review. Please find the requested information below.

1. SCREEN RECORDING
A screen recording captured on a physical iPhone running iOS <iOS-Version> is attached in the App Review Information section (alternative link: <Video-Link>). It starts with launching the app and shows: account registration, confirming the e-mail address, creating a personal workspace, creating and editing a ticket (incl. photo attachment), inviting a team member, knowledge base, settings, sign-out, sign-in with the demo account and account deletion.

- Account registration: On the sign-in screen tap "Neu bei nextDesk? Konto erstellen" (create account), enter name, e-mail and password and confirm the e-mail address. Afterwards the app asks for the name of the personal workspace.
- Account deletion: Settings (profile icon at the top right of the home screen) > scroll to the bottom > "Konto löschen" (delete account) > confirm. This permanently deletes the account and the personal workspace with all its data. Accounts without a workspace find "Konto löschen" directly on the "Arbeitsbereich erstellen" screen. Instructions are also published at https://nextdesk.ch/konto-loeschen.html
- User-generated content: Tickets and replies are only visible to members of the same workspace. Members join a workspace exclusively by invitation from its owner, who can remove members at any time (Settings > Team). There is no public content, no social feed and no contact between unrelated users.
- Paid content: The app contains no in-app purchases, paid features or purchase links.

2. PURPOSE AND TARGET AUDIENCE
nextDesk is a help desk / ticketing app developed by Gross ICT, Switzerland. Anyone can register: individuals and small teams create their own workspace and invite colleagues to work on tickets together. Organisations such as schools and companies can additionally use nextDesk with their own Microsoft single sign-on.
Users submit requests as tickets, follow their progress, reply, change status and priority, receive push notifications and look up knowledge base articles and devices.
Problem solved: requests no longer get lost in e-mails, chats and phone calls, and teams can respond from anywhere.

3. HOW TO ACCESS THE APP
You can register a new account (see above) or use the demo account from the Sign-In Information:
1. Open the app and tap "Mit Passwort anmelden" (sign in with password).
2. Enter the demo e-mail and password and tap "ANMELDEN".
The demo account owns a workspace with sample tickets and knowledge articles. "MIT SSO ANMELDEN" (Microsoft single sign-on) only works for organisations that connected their own Microsoft account. The app language is German.

4. EXTERNAL SERVICES
- Supabase (hosted in Zurich, Switzerland): database, authentication, file storage and server functions
- Microsoft Entra ID: optional single sign-on for organisations
- Apple Push Notification service: ticket notifications
The app uses no payment processors and no advertising or tracking services.

5. REGIONAL DIFFERENCES
The app functions consistently across all regions. Content is in German and all data is stored in Switzerland.

6. REGULATED INDUSTRY / THIRD-PARTY MATERIAL
nextDesk does not operate in a regulated industry and does not include protected third-party material. All content is created by the users themselves.
```

---

## Vor dem Einreichen prüfen

- Supabase → Authentication → Sign In / Providers: **„Allow new users to sign up“ aktiv**, E-Mail-Bestätigung aktiv.
- Supabase → Authentication → URL Configuration: `ch.grossict.nextdesk://auth/callback` und `https://app.nextdesk.ch/` als Redirect-URLs erlaubt.
- Migration `0153` angewendet und Edge Function `account` deployt (siehe unten), **bevor** der neue Build zur Prüfung geht.
- Demo-Konto mit eigenem Arbeitsbereich und Beispieltickets angelegt.

## Deployment

```bash
supabase db push                     # Migration 0153
supabase functions deploy account
```
