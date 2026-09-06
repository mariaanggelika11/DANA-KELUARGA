import { app } from './app';
import { env } from './config/env';

app.listen(env.PORT, () => console.log(`Dana Keluarga API berjalan di port ${env.PORT}`));
