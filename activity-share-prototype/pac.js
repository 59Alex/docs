function FindProxyForURL(url, host) {
  var d = ["localhost","127.0.0.1",".ru",".vk.com","vk.com",".userapi.com",".vkuser.net",".mycdn.me",".okcdn.ru",".vk-cdn.net",".rtbcdn.ru",".mail.ru",".yandex.net"];
  for (var i = 0; i < d.length; i++) { if (host === d[i] || (d[i][0] === "." && dnsDomainIs(host, d[i]))) return "DIRECT"; }
  return "SOCKS5 127.0.0.1:10808"; }