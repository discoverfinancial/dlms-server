# Uninstall modules so changes will be applied
npm uninstall dlms-base

# Build dlms-base
pushd ..\base
npm run build
popd

# Install modules
copy ..\dlms-base-1.0.7.tgz .
npm install dlms-base-1.0.7.tgz
