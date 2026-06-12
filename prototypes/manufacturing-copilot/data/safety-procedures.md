# Public OSHA Safety Source Index

These retrieval chunks are grounded in local copies of public OSHA publications
stored under `data/sources/`. Page references below use PDF page numbers from
the downloaded OSHA files.

## OSHA-3120: Lockout/Tagout Definition And Purpose
<!-- source_title: OSHA 3120 Control of Hazardous Energy Lockout/Tagout -->
<!-- source_url: https://www.osha.gov/sites/default/files/publications/OSHA3120.pdf -->
<!-- source_pdf: data/sources/OSHA3120-lockout-tagout.pdf -->
<!-- source_page: 7 -->

Lockout/tagout refers to practices and procedures used to protect employees
from unexpected energization, startup, or release of hazardous energy during
machine service or maintenance. A floor supervisor may receive explanatory
guidance about what LOTO is and when to escalate, but the copilot must not
execute energy-control actions or authorize bypassing safeguards.

## OSHA-3120: Energy Control Procedures
<!-- source_title: OSHA 3120 Control of Hazardous Energy Lockout/Tagout -->
<!-- source_url: https://www.osha.gov/sites/default/files/publications/OSHA3120.pdf -->
<!-- source_pdf: data/sources/OSHA3120-lockout-tagout.pdf -->
<!-- source_page: 13 -->

OSHA describes energy-control procedures as documented instructions for
controlling potentially hazardous energy during service or maintenance. The
procedure should tell employees what they must know and do to isolate energy
sources, render equipment inoperative, apply devices, release stored energy,
and verify control before work starts.

## OSHA-3120: Training Roles For Authorized And Affected Employees
<!-- source_title: OSHA 3120 Control of Hazardous Energy Lockout/Tagout -->
<!-- source_url: https://www.osha.gov/sites/default/files/publications/OSHA3120.pdf -->
<!-- source_pdf: data/sources/OSHA3120-lockout-tagout.pdf -->
<!-- source_page: 19 -->

Authorized employees need training on hazardous energy recognition, magnitude,
type, and control methods. Affected employees need instruction on the purpose
and use of the energy-control procedure, including the importance of not
tampering with lockout/tagout devices and not starting locked or tagged
equipment.

## OSHA-3120: Testing Or Positioning Under LOTO
<!-- source_title: OSHA 3120 Control of Hazardous Energy Lockout/Tagout -->
<!-- source_url: https://www.osha.gov/sites/default/files/publications/OSHA3120.pdf -->
<!-- source_pdf: data/sources/OSHA3120-lockout-tagout.pdf -->
<!-- source_page: 21 -->

OSHA allows temporary removal of lockout/tagout devices and reenergization only
in limited testing or positioning situations and only when the employer follows
the required sequence. A chatbot may summarize the need to use the approved
energy-control process, but it must not provide shortcut instructions for
bypassing a device.

## OSHA-3170: What Machine Guards And Interlocks Do
<!-- source_title: OSHA 3170 Safeguarding Equipment and Protecting Employees from Amputations -->
<!-- source_url: https://www.osha.gov/sites/default/files/publications/OSHA3170.pdf -->
<!-- source_pdf: data/sources/OSHA3170-amputation-machine-guarding.pdf -->
<!-- source_page: 13 -->

Machine guards and safeguarding devices protect employees from hazardous
machine areas. Interlocking barrier guards are safeguards that are tied into a
machine control system so opening or removing the guard prevents or stops
hazardous machine motion. An interlock is therefore a safety-control interface,
not a production control to defeat.

## OSHA-3170: Interlocking Barrier Guards
<!-- source_title: OSHA 3170 Safeguarding Equipment and Protecting Employees from Amputations -->
<!-- source_url: https://www.osha.gov/sites/default/files/publications/OSHA3170.pdf -->
<!-- source_pdf: data/sources/OSHA3170-amputation-machine-guarding.pdf -->
<!-- source_page: 14 -->

OSHA lists interlocking barrier guards among common machine guards. Their
purpose is to prevent access to danger areas and interface with machine controls
so employees are protected from hazardous motion. The copilot can define this
concept and direct a supervisor to report a defeated guard, but should not
describe how to bypass it.

## OSHA-3170: Presence-Sensing Devices
<!-- source_title: OSHA 3170 Safeguarding Equipment and Protecting Employees from Amputations -->
<!-- source_url: https://www.osha.gov/sites/default/files/publications/OSHA3170.pdf -->
<!-- source_pdf: data/sources/OSHA3170-amputation-machine-guarding.pdf -->
<!-- source_page: 16 -->

Presence-sensing devices can interlock with a machine control system to stop
operation when a hand or body part is detected in the danger area. Light
curtains and related sensing devices are safety controls. Requests to mute,
defeat, override, or disable them are physical-control intents and must be
blocked before tool execution.
