# Skool Platform Requirements — 2026-06-12 Refresh

Guardrail: do not publish posts, upload files, submit forms, change billing, or enable paid-community settings without action-time confirmation.

## Official help-center refresh

Re-verified from Skool official help sources on 2026-06-12:

- Discovery eligibility still requires a group description, About page description/images, a cover image, and a minimum threshold of members, posts, and activity. Discovery FAQ last updated `April 8, 2026`.
- Discovery FAQ still warns that Discovery algorithm updates are coming in `Q2 of 2026`, so ranking specifics may shift even though the current eligibility rules still hold.
- Discovery onboarding for newer groups still calls out: cover image, group description, completed About page, at least one post, and invited members. Visibility is described as `within two hours` in the FAQ, while the checklist still says `usually within an hour`. Checklist article last updated `April 15, 2026`.
- Discovery ranking still rewards member growth, engagement, retention, high-quality artwork/About copy, authentic human engagement, and active owners/admins.
- Discovery ranking still penalizes bots/fake accounts, spam or low-quality engagement, low-quality artwork/About copy, `payments off-platform`, bad customer support, and inactive owners.
- Invite mechanics for free communities still support direct email, CSV import, and Zapier-driven invites, and invited members still need to click `JOIN NOW` for pre-approval to complete. Invite-members article last updated `June 1, 2026`.
- Membership intake still caps groups at `3` questions total, with only `1` email-type field. Membership questions article last updated `September 19, 2025`.
- Group pricing options still include `free`, `subscription`, `freemium`, `tiered pricing`, and `one-time payment`. Pricing setup article last updated `October 28, 2025`.
- The About page is still required for Discovery eligibility and is explicitly framed by Skool as a landing/checkout surface that supports uploaded images and videos. About-page article last updated `December 9, 2025`.
- Classroom course creation still starts published by default, with a toggle back to draft. Publish-a-course article last updated `March 13, 2025`.
- Course access modes still support `Open`, `Level unlock`, `Buy now`, `Time unlock`, and `Private`, with tier combinations available through private/tier access. Course-permissions article last updated `November 10, 2025`.
- The current `What is Classroom?` article was updated `May 29, 2026` and still confirms that pages can be published independently, organized into folders, and expanded with resource links/files plus pinned community posts.
- Skool's current video docs still support both native video uploads inside Classroom/posts and Loom embeds for Classroom pages. `How to add videos` was last updated `February 12, 2026`, and `How to add Loom videos?` was last updated `February 12, 2026`. This matters because the local environment is still blocked on the native file picker even though the platform supports the upload path.
- Community anti-spam guidance still routes through `AutoMod` best practices updated `April 2, 2026`, including manual approval, membership questions, posting/chat level gates, and ban/delete-last-7-days cleanup.
- The current AutoMod doc explicitly says the feature is now active in all communities, flags high-risk users for admin review, and recommends banning/removing obvious spam before it spreads.
- Skool's AutoMod guidance also says even a small paid barrier can reduce spam, but that remains the wrong move for ThumbGate right now because Operator Lab still lacks the minimum public proof density and the primary money motion stays on ThumbGate-owned Diagnostic/Sprint/Pro surfaces.
- Skool documents a first-party Meta pixel plugin for About-page view, membership-request, and purchase tracking, and the current help article also warns against layering extra trackers like GTM into the same dataset. Keep it parked unless ads/tracking are explicitly approved.
- Payments FAQ still shows Pro transaction fees of `2.9% + 30c` up to `$899` and `3.9% + 30c` above `$900`, with Hobby at `10% + 30c`. Payments FAQ last updated `April 22, 2026`.
- Paid communities still use a Skool-managed Stripe Express payout path rather than a standalone Stripe account connection. Payout setup article last updated `January 22, 2026`.
- Payout status guidance still says payouts initiate weekly on Wednesdays, with first funds taking roughly `8` to `14` days to become available. Payout-status article last updated `May 5, 2026`.

## Verified Operator Lab state on 2026-06-12

- `node scripts/skool-reader.js --url https://www.skool.com/thumbgate-operator-lab-6000 --signals --format markdown` currently reports `Members: 1` and `Visible posts on page: 0`.
- The free-group posture still matches Skool's documented Discovery rules better than a paid-first posture because public proof density is still too thin.
- The next Discovery unlock is not pricing work. It is surface density: at least one visible value-first post plus more member/activity evidence.
- `docs/marketing/assets/` is still missing from this checkout, so local proof for media-backed course/about updates is unavailable right now even though the platform supports uploads and embeds.

## Operator implications

1. Keep ThumbGate Operator Lab as a free, value-first group until there is evidence that paid course packaging outperforms the current owned checkout path.
2. Do not lead public Skool surfaces with Pro, Diagnostic, or Sprint checkout language because Discovery still treats off-platform payments as a penalty.
3. Finish public conversion hygiene before worrying about monetized Skool settings: About page, artwork, at least one public post, and invite/member activity matter more than adding paid options.
4. Use the free first course as onboarding and proof, not as the paid close. Paid closes should still happen after direct pain confirmation on ThumbGate-owned surfaces.
5. Because About-page conversion and payout surfaces are controlled inside Skool, avoid interpreting same-day promo traffic as channel proof unless authenticated readback confirms it.
6. If spam or low-quality join traffic shows up as Discovery visibility improves, use Skool-native moderation levers before changing the free-group positioning: manual approval, membership questions, posting/chat level gates, and ban/delete-last-7-days cleanup are explicitly documented by Skool.
7. Treat Meta pixel setup as a parked measurement option, not an immediate task. It only becomes relevant if paid/retargeting work is explicitly approved.
8. Because the current local environment cannot complete a native media upload reliably, the safest next live Skool edits are copy-only posts/pages or a Loom-link embed path instead of assuming the local MP4 assets are upload-ready.

## Sources

- [Discovery FAQs](https://help.skool.com/article/153-discovery-faqs)
- [Why isn't my group visible on Discovery?](https://help.skool.com/article/151-why-isnt-my-group-visible-in-discovery)
- [How to set up my group's About page?](https://help.skool.com/article/123-how-to-set-up-my-group-s-about-page)
- [How do I invite members to my community?](https://help.skool.com/article/14-how-do-i-invite-members-to-my-community)
- [How to publish a course?](https://help.skool.com/article/143-how-to-publish-a-course)
- [How to set permissions for a course](https://help.skool.com/article/23-how-to-set-permissions-for-a-course)
- [What is Classroom?](https://help.skool.com/article/166-what-is-classroom)
- [How to add videos](https://help.skool.com/article/58-video)
- [How to add Loom videos?](https://help.skool.com/article/225-how-to-add-loom-videos)
- [How to manage spam (New! AutoMod)](https://help.skool.com/article/184-how-to-manage-spam-in-your-skool-community)
- [How to set up Meta (Facebook) pixel tracking?](https://help.skool.com/article/163-how-to-set-up-facebook-pixel-tracking)
- [Skool Payments FAQs](https://help.skool.com/article/86-subscriptions-faq)
- [How to set up payouts for your community?](https://help.skool.com/article/78-how-to-setup-skool-subscriptions)
- [How to check the Skool payout status?](https://help.skool.com/article/85-how-to-check-the-skool-subscriptions-payout)
