class Thumbgate < Formula
  desc "Token optimization, loop circuit-breaker, and PreToolUse firewall for AI agents"
  homepage "https://thumbgate.ai"
  url "https://registry.npmjs.org/thumbgate/-/thumbgate-1.40.0.tgz"
  sha256 "687d75cbe9b2ffe42f27eb173ca534c3606dbcbf000000000000000000000000"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      ThumbGate local CLI is installed (100% MIT-free forever).
      1. Initialize local PreToolUse firewall:
           thumbgate init
      2. Sign in to ThumbGate Cloud with 1-Click Browser SSO:
           thumbgate login --sso
      3. Open Cloud Customer Portal:
           https://thumbgate.ai/cloud
    EOS
  end

  test do
    assert_match "1.40.0", shell_output("#{bin}/thumbgate --version")
  end
end
