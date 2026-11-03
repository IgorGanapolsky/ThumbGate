function handleCheckoutAlias(req, res) {
  const pathname = req.url.split('?')[0];
  if (pathname === '/pro-direct') {
    res.writeHead(302, { Location: '/go/pro-direct' });
    return true;
  }
  return false;
}
