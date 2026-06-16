# Skool Platform Requirements — 2026-06-12 Refresh

Guardrail: do not publish posts, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Official help-center refresh

Re-verified from Skool official help sources on 2026-06-13:

- Discovery eligibility still requires a group description, About page description/images, a cover image, and a minimum threshold of members, posts, and activity. Discovery FAQ last updated `April 8, 2026`.
- Discovery FAQ currently also warns that Discovery algorithm updates are coming in `Q2 of 2026`, so ranking specifics may shift even though the current eligibility rules still hold.
- Discovery onboarding for newer groups still calls out: cover image, group description, completed About page, at least one post, and invited members. Visibility is described as `within two hours` after the threshold in the FAQ, while the checklist still says `usually within an hour`. Checklist article last updated `April 15, 2026`.
- Discovery ranking still rewards member growth, engagement, retention, high-quality artwork/About copy, authentic human engagement, and active owners/admins.
- Discovery ranking still penalizes bots/fake accounts, spam or low-quality engagement, low-quality artwork/About copy, `payments off-platform`, bad customer support, and inactive owners.
- Free-community invites are still supported via share link, email invite, bulk CSV import, and Zapier invite flows from the Invite tab. Invite article last updated `June 1, 2026`.
- Membership intake still caps groups at `3` questions total, with only `1` email-type field. Membership questions article last updated `September 19, 2025`.
- Group pricing options still include `free`, `subscription`, `freemium`, `tiered pricing`, and `one-time payment`. Pricing setup article last updated `October 28, 2025`.
- The About page is still required for Discovery eligibility and is explicitly framed by Skool as a landing/checkout surface that supports uploaded images and videos. About-page article last updated `December 9, 2025`.
- Classroom visibility is still controlled at the group tab level, so a free starter course is only useful if the Classroom tab is actually enabled for the community. Classroom article last updated `May 29, 2026`.
- Classroom course creation still starts published by default, with a toggle back to draft. Publish-a-course article last updated `March 13, 2025`.
- Course access modes still support `Open`, `Level unlock`, `Buy now`, `Time unlock`, and `Private`, with tier combinations available through private/tier access. Course-permissions article last updated `November 10, 2025`.
- Skool still supports direct native video upload inside Classroom pages plus community posts/comments, so media friction here is operational tooling friction, not a missing product capability. Video article last updated `February 12, 2026`.
- Payments FAQ still shows Pro transaction fees of `2.9% + 30c` up to `$899` and `3.9% + 30c` above `$900`, with Hobby at `10% + 30c`. Payments FAQ last updated `April 22, 2026`.
- Paid communities still use a Skool-managed Stripe Express payout path rather than a normal standalone Stripe account connection. Payout setup article last updated `January 22, 2026`.
- Payout status guidance still says payouts initiate weekly on Wednesdays, with first funds taking roughly `8` to `14` days to become available. Payout-status article last updated `May 5, 2026`.
- Skool now explicitly recommends anti-spam controls such as turning off instant membership approval, enabling membership questions, and gating posting/chat access by level before spam becomes a growth drag.
- Skool now also states that AutoMod is active in all communities and explicitly positions even low-cost monetization as a spam reducer, but that does not outweigh the current ThumbGate need for a free, value-first public surface while warm outbound remains the higher-ROI revenue lane.

## Operator implications

1. Keep ThumbGate Operator Lab as a free, value-first group until there is evidence that paid course packaging outperforms the current owned checkout path.
2. Do not lead public Skool surfaces with Pro, Diagnostic, or Sprint checkout language because Discovery still treats off-platform payments as a penalty.
3. Finish public conversion hygiene before worrying about monetized Skool settings: About page, artwork, at least one public post, and invite/member activity still matter more than adding paid options.
4. Keep Classroom visibly enabled before treating the free first course as real onboarding inventory; a published course is not enough if the tab itself is hidden.
5. Use the free first course as onboarding and proof, not as the paid close. Paid closes should still happen after direct pain confirmation on ThumbGate-owned surfaces.
6. Keep membership quality controls tighter than growth hacks: manual approval, membership questions, and level-gated posting/chat are safer than opening the group to low-trust traffic too early.
7. Because About-page conversion and payout surfaces are controlled inside Skool, avoid interpreting same-day promo traffic as channel proof unless authenticated readback confirms it.
8. Because Skool already supports direct file/video upload and free invite distribution, the bottlenecks to clear next are operational: authenticated browser verification and asset restoration in the repo/workflow path.

## ThumbGate-specific posture

- Current best-fit posture remains unchanged:
  - free Skool group
  - one free starter course
  - value-first public copy
  - paid conversion only after a direct follow-up or confirmed workflow pain
- The local runtime can now read the public Skool page headlessly again, but the current baseline is weak: `Members: 1` and `Visible posts on page: 0` as of `2026-06-13T02:12:06Z`.
- Direct public-page fetch of `https://www.skool.com/thumbgate-operator-lab-6000` now confirms the top-level shell is visible with `Community`, `Classroom`, `Calendar`, `Members`, `Leaderboards`, and `About` tabs plus a `JOIN GROUP` CTA.
- Headless/public readback still does not verify About-page copy quality, Classroom lesson inventory, membership questions, or approval settings, so browser-authenticated verification is still required before making richer public-surface claims.

## Sources

- [Discovery FAQs](https://help.skool.com/article/153-discovery-faqs)
- [Why isn't my group visible on Discovery?](https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery)
- [How to setup pricing for the group?](https://help.skool.com/article/215-how-to-setup-pricing-for-the-group)
- [How to set up my group’s About page?](https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page)
- [How to set up Membership Questions?](https://help.skool.com/article/57-how-to-set-up-membership-questions)
- [How do I invite members to my community?](https://help.skool.com/article/14-how-do-i-invite-members-to-my-community)
- [How to publish a course?](https://help.skool.com/article/143-how-to-publish-a-course)
- [What is Classroom?](https://help.skool.com/article/166-what-is-classroom)
- [How to set permissions for a course](https://help.skool.com/article/23-how-to-set-permissions-for-a-course)
- [How to add videos](https://help.skool.com/article/58-video)
- [Skool Payments FAQs](https://help.skool.com/article/86-subscriptions-faq)
- [How to set up payouts for your community?](https://help.skool.com/article/78-how-to-setup-skool-subscriptions)
- [How to check the Skool payout status?](https://help.skool.com/article/85-how-to-check-the-skool-subscriptions-payout)
- [How to manage spam (New! AutoMod)](https://help.skool.com/article/184-how-to-manage-spam-in-your-skool-community)
