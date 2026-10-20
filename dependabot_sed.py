import re

with open('.github/dependabot.yml', 'r') as f:
    content = f.read()

# Remove all auto-merge blocks and preceding comments
content = re.sub(r'\s*# Native GitHub auto-merge.*?\n.*?(auto-merge:.*?wait_for_all_checks: true)', '', content, flags=re.DOTALL)
content = re.sub(r'\s*auto-merge:.*?wait_for_all_checks: true', '', content, flags=re.DOTALL)

with open('.github/dependabot.yml', 'w') as f:
    f.write(content)
