---
title: "How to Add Guardrails to Claude Code: Stop Repeated Mistakes"
description: "Learn how to use MCP and Pre-Action Gates to physically block Claude Code from repeating the same expensive mistakes."
author: "Igor Ganapolsky"
date: "2026-04-14"
---

# How to Add Guardrails to Claude Code: Stop Repeated Mistakes

If you use Claude Code for daily development, you already know its power. It can refactor entire modules, write tests, and navigate complex codebases. But you also know its biggest flaw: **it repeats the same mistakes.**

You tell it, "Never use the deprecated `passport.js` library, use `auth-v2`." It works for that session. Two days later, in a new session, it tries to install `passport.js` again. 

Prompt engineering isn't enough for autonomous agents. You need hard guardrails. In this tutorial, we'll show you how to use the Model Context Protocol (MCP) and **ThumbGate** to physically block Claude Code from repeating mistakes.

## The Problem with System Prompts

Most developers try to solve agent amnesia by stuffing rules into a `.clauderc` file or a custom system prompt. This approach fails for three reasons:

1. **Context Window Dilution:** As the session grows, the LLM pays less attention to the initial system prompt.
2. **Lack of Enforcement:** A prompt is a suggestion, not a physical barrier. If the LLM decides to ignore the rule, the tool call (like `execute_command` or `edit_file`) still runs.
3. **Maintenance Nightmare:** Your system prompt quickly becomes a 500-line document of edge cases that no human can read or maintain.

## The Solution: Pre-Action Gates via MCP

Instead of relying on the LLM to remember rules, we can intercept the tool call *before* it executes. 

The Model Context Protocol (MCP) allows us to inject middleware between the LLM's decision and the actual execution on your machine. By using a local gateway like ThumbGate, we can evaluate every proposed action against a database of past mistakes.

If the action matches a known bad pattern, the gateway physically blocks the execution and returns an error to the LLM, forcing it to correct itself.

## Step 1: Install ThumbGate

ThumbGate is an open-source CLI that acts as a local memory and enforcement layer for MCP-compatible agents.

Run the following command in your terminal to initialize ThumbGate in your repository:

```bash
npx thumbgate init --agent claude-code
```

This command does two things:
1. It creates a local SQLite database (`.thumbgate/memory.db`) to store your rules.
2. It registers the ThumbGate MCP server with your local Claude Code configuration.

## Step 2: Give Feedback (The "Thumbs Down")

ThumbGate doesn't require you to write complex JSON schemas or regex rules. It learns from natural language feedback.

When Claude Code makes a mistake, simply type a `thumbs down` command followed by a one-sentence correction.

**Example:**
Claude Code tries to run a destructive database migration. You hit `Ctrl+C` to stop it, then type:

```bash
thumbs down: Never run DROP TABLE on production databases. Always use safe migrations.
```

## Step 3: The Gate Auto-Generates

ThumbGate intercepts your feedback, analyzes the context of the failed tool call, and distills it into a permanent **Pre-Action Gate**. 

You will see a confirmation in your terminal:

```bash
✅ Lesson distilled. Pre-Action Gate created: Block DROP TABLE commands.
```

This rule is now stored locally and applies to all future Claude Code sessions in this repository.

## Step 4: Watch the Enforcement in Action

The next time Claude Code (or any other connected agent like Cursor or Gemini) tries to execute a similar destructive command, ThumbGate's PreToolUse hook will intercept it.

Instead of executing the command, ThumbGate returns a hard block to the LLM:

```bash
⛔ Gate blocked: "Never run DROP TABLE on production databases. Always use safe migrations."
```

Because the block happens *before* execution, your system is safe. Furthermore, the LLM reads the error message, understands why it was blocked, and automatically generates a corrected tool call using the safe migration pattern you specified.

## Conclusion: Fix It Once, Block the Repeat

By moving enforcement out of the prompt and into the execution layer via MCP, you transform Claude Code from an unpredictable assistant into a reliable operator. 

You only have to correct a mistake once. ThumbGate ensures it never happens again.

To get started, run `npx thumbgate init` or visit the [ThumbGate GitHub repository](https://github.com/IgorGanapolsky/ThumbGate) for more advanced configuration options, including team-wide rule sharing and visual dashboards.
