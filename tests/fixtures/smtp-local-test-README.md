This public certificate and private key belong only to the automated local SMTP
fixture. They identify `localhost` and `127.0.0.1`, contain no production
credentials, and must never be used by a deployed service. The regression helper
binds only loopback interfaces and trusts this certificate only in its isolated
test processes. Replace both files together before the certificate expires in
October 2036.
