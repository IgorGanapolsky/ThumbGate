# Deny and warn

## Deny

The tool input contains a credential and the command would send it to another host.

Result: deny. The agent stops. It does not rewrite the command with the same credential still inside it.

## Warn

The tool input is a purchase against an internal spend policy, and no credential is present.

Result: warn. The agent shows the warning. That warning does not allow a later call that carries a secret.

## Repeat

A ranked lesson already records this same failure in the repository.

Result: deny. One warning earlier is not a reason to try the same action again.
